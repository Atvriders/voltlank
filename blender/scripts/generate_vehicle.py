# VoltLink vehicle asset generator (Blender 5.x, headless).
#
# Generates the five original VoltLink vehicle classes as GLB with a named-part
# convention consumed by apps/web/src/webgl/VehicleViewer.tsx:
#   body, windows, wheels, mirrors, interior,
#   door_fl, door_fr, door_rl, door_rr, trunk, frunk,
#   charge_port, charge_connector, headlights, taillights
#
# Usage:
#   blender -b -P generate_vehicle.py -- --class suv [--lod] [--out <dir>]
#
# Each class has a clearly distinct silhouette (proportions, greenhouse, bed,
# ride height) so the five vehicles are visibly different in the showroom.

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector, Euler, Matrix

# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------

MAT_CACHE = {}

LOD = False  # set per-run in main(); low-detail export


def mat(name, base, metallic=0.0, roughness=0.5, emission=None, emission_strength=1.0, transmission=0.0):
    key = (name, tuple(base), metallic, roughness, emission, emission_strength, transmission)
    if key in MAT_CACHE:
        return MAT_CACHE[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    bsdf.inputs["Transmission Weight"].default_value = transmission
    if transmission > 0:
        bsdf.inputs["Roughness"].default_value = 0.08
    MAT_CACHE[key] = m
    return m


def assign(mesh_obj, material):
    if mesh_obj.data.materials:
        mesh_obj.data.materials[0] = material
    else:
        mesh_obj.data.materials.append(material)


def smooth(mesh_obj):
    mesh_obj.data.polygons.foreach_set("use_smooth", [True] * len(mesh_obj.data.polygons))
    mesh_obj.data.update()


# --------------------------------------------------------------------------
# Primitives
# --------------------------------------------------------------------------

def box(name, size, location=(0, 0, 0), rotation=(0, 0, 0), material=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = Vector(size)
    if material:
        assign(obj, material)
    smooth(obj)
    return obj


def cylinder(name, radius, depth, location=(0, 0, 0), rotation=(0, 0, 0), material=None, segments=32):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=segments, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    if material:
        assign(obj, material)
    smooth(obj)
    return obj


def sphere(name, radius, location=(0, 0, 0), material=None, segments=24):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=location, segments=segments, ring_count=12)
    obj = bpy.context.active_object
    obj.name = name
    if material:
        assign(obj, material)
    smooth(obj)
    return obj


def empty(name, location=(0, 0, 0)):
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=location)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def parent(child, parent_obj):
    child.parent = parent_obj
    child.matrix_parent_inverse = parent_obj.matrix_world.inverted()


def bevel(obj, width=0.03, segments=2):
    if LOD:
        return
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = 2 if segments else 1
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(50)


def set_origin(obj, world_point):
    saved = bpy.context.scene.cursor.location
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.context.scene.cursor.location = world_point
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.context.scene.cursor.location = saved


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


# --------------------------------------------------------------------------
# Shared assembly: wheels, mirrors, lamps, ports
# --------------------------------------------------------------------------

def build_wheels(spec, rim_r, tire_w, mat_tire, mat_rim):
    """spec: dict with axle_y (front/back), track (half-width)."""
    group = empty("wheels")
    seg = 14 if LOD else 28
    for axle_key in ("front", "rear"):
        ay, z, track, rim = spec[axle_key]
        for side in (-1, 1):
            name = f"wheel_{'f' if axle_key == 'front' else 'r'}{'l' if side < 0 else 'r'}"
            tire = cylinder(name, rim_r, tire_w, (side * track, z, ay), (0, math.pi / 2, 0), mat_tire, seg)
            hub = cylinder(name + "_rim", rim, tire_w * 0.55, (side * track, z, ay), (0, math.pi / 2, 0), mat_rim, 12 if LOD else 20)
            parent(hub, tire)
            parent(tire, group)
    return group


def build_mirrors(mat_body, mat_mirror):
    group = empty("mirrors")
    for side in (-1, 1):
        stalk = box(f"mirror_{'l' if side < 0 else 'r'}_stalk", (0.05, 0.16, 0.03), (side * 0.92, 1.18, 0.78), material=mat_body)
        head = box(f"mirror_{'l' if side < 0 else 'r'}_head", (0.09, 0.2, 0.1), (side * 1.0, 1.16, 0.78), material=mat_body)
        glass = box("mirror_glass", (0.005, 0.14, 0.07), (side * 0.965, 1.16, 0.79), material=mat_mirror)
        parent(stalk, group)
        parent(head, group)
        parent(glass, group)
    return group


def build_lamps(front_y, rear_y, z, front_x_half, rear_x_half, rear_z=None):
    hl = empty("headlights")
    for side in (-1, 1):
        lamp = box("headlight_lamp", (0.34, 0.06, 0.11), (side * front_x_half * 0.62, z, front_y), material=mat("headlight", (0.9, 0.95, 1.0), emission=(0.6, 0.8, 1.0), emission_strength=2.0))
        parent(lamp, hl)
    tl = empty("taillights")
    rz = rear_z if rear_z is not None else z
    for side in (-1, 1):
        lamp = box("taillight_lamp", (0.3, 0.05, 0.1), (side * rear_x_half * 0.62, rz, rear_y), material=mat("taillight", (0.55, 0.05, 0.05), emission=(0.9, 0.08, 0.08), emission_strength=2.0))
        parent(lamp, tl)
    return hl, tl


def build_interior(spec, mat_seat, mat_dash):
    """Seats, dash, steering wheel under an 'interior' empty."""
    group = empty("interior")
    cab = spec["cab"]
    y = cab["y"]  # cabin center y
    for name, (sx, sy, sz), (x, yy, zz), rot in spec["seats"]:
        seat = box(name, (sx, sy, sz), (x, yy, zz), rot, material=mat_seat)
        bevel(seat, 0.03, 1)
        parent(seat, group)
    dash = box("dash", spec["dash_size"], spec["dash_pos"], spec.get("dash_rot", (0, 0, 0)), material=mat_dash)
    bevel(dash, 0.025, 1)
    parent(dash, group)
    wheel_pos = spec["wheel_pos"]
    bpy.ops.mesh.primitive_torus_add(major_radius=0.19, minor_radius=0.025, location=wheel_pos, rotation=(0, math.pi / 2.2, 0))
    sw = bpy.context.active_object
    sw.name = "steering_wheel"
    assign(sw, mat_dash)
    smooth(sw)
    parent(sw, group)
    col = cylinder("steering_column", 0.025, 0.35, (wheel_pos[0], wheel_pos[1], wheel_pos[2] - 0.18), material=mat_dash)
    parent(col, group)
    return group


def build_charge(spec, mat_port, mat_conn):
    """Charge port flap on the left rear quarter + connector."""
    p = spec["charge_port"]  # (x, z, y, flap_size)
    x, z, y, size = p
    port = box("charge_port", (size, 0.02, size * 1.15), (x, z, y), material=mat_port)
    set_origin(port, (x - size / 2, y, z))  # hinge at leading edge
    conn = cylinder("charge_connector", 0.035, 0.12, (x - 0.01, z, y), (0, math.pi / 2, 0), mat("connector", (0.1, 0.12, 0.14), emission=(0.13, 0.83, 0.93), emission_strength=1.5), 16)
    parent(conn, port)
    return port


# --------------------------------------------------------------------------
# Per-class builders — distinct, original silhouettes
# --------------------------------------------------------------------------

PAINT = {
    "compact_sedan": (0.16, 0.34, 0.56),   # Volt Blue
    "sport_sedan": (0.75, 0.18, 0.14),     # Ember Red
    "compact_crossover": (0.19, 0.52, 0.46),  # Pine
    "suv": (0.30, 0.32, 0.36),             # Graphite
    "pickup": (0.76, 0.47, 0.13),          # Harvest Gold
}


def build_compact_sedan(lod):
    paint = mat("paint", PAINT["compact_sedan"], metallic=0.55, roughness=0.3)
    trim = mat("trim", (0.09, 0.10, 0.11), roughness=0.8)
    glass = mat("glass", (0.05, 0.07, 0.09), roughness=0.1, transmission=0.85)
    seat = mat("seat", (0.16, 0.15, 0.14), roughness=0.9)
    dash = mat("dash", (0.07, 0.07, 0.08), roughness=0.7)
    # body: low slab + tapered greenhouse, rounded hatch rear
    body = empty("body")
    base = box("base", (1.78, 0.42, 3.95), (0, 0.36, 0), material=paint)
    bevel(base, 0.09, 2 if not lod else 1)
    nose = box("nose", (1.7, 0.34, 0.62), (0, 0.5, 2.0), material=paint)
    bevel(nose, 0.07, 1)
    cab = box("cab", (1.6, 0.48, 2.05), (0, 0.96, -0.12), material=paint)
    bevel(cab, 0.11, 2 if not lod else 1)
    hatch = box("hatch", (1.6, 0.75, 0.5), (0, 1.1, -1.9), (math.radians(-24), 0, 0), material=paint)
    bevel(hatch, 0.06, 1)
    for part in (base, nose, cab, hatch):
        parent(part, body)
    windows = empty("windows")
    for side in (-1, 1):
        w = box("window_glass", (0.03, 0.42, 1.5), (side * 0.8, 1.08, -0.1), material=glass)
        parent(w, windows)
    windshield = box("windshield", (1.5, 0.6, 0.05), (0, 1.18, 0.95), (math.radians(38), 0, 0), material=glass)
    parent(windshield, windows)
    rear = box("rear_window", (1.42, 0.42, 0.05), (0, 1.16, -1.5), (math.radians(-34), 0, 0), material=glass)
    parent(rear, windows)
    wheels = build_wheels(
        {"front": (1.28, 0.31, 0.78, 0.19), "rear": (-1.28, 0.31, 0.78, 0.19)},
        0.31, 0.22, trim, mat("rim", (0.78, 0.8, 0.82), metallic=0.9, roughness=0.25))
    mirrors = build_mirrors(paint, mat("mirror", (0.7, 0.85, 0.95), metallic=0.4, roughness=0.1))
    hl, tl = build_lamps(2.02, -1.98, 0.62, 1.7, 1.6)
    spec = {
        "cab": {"y": 0},
        "seats": [
            ("seat_fl", (0.5, 0.12, 0.55), (-0.36, 0.72, 0.75), (0, 0, math.radians(-8))),
            ("seat_fr", (0.5, 0.12, 0.55), (0.36, 0.72, 0.75), (0, 0, math.radians(8))),
            ("seat_rear", (1.24, 0.12, 0.55), (0, 0.72, -0.45), (0, 0, 0)),
        ],
        "dash_size": (1.3, 0.12, 0.5),
        "dash_pos": (0, 0.86, 1.28),
        "wheel_pos": (0.36, 0.9, 1.1),
    }
    interior = build_interior(spec, seat, dash)
    port = build_charge({"charge_port": (-0.88, 0.78, -1.2, 0.24)}, paint, mat("connector", (0.1, 0.12, 0.14), emission=(0.13, 0.83, 0.93), emission_strength=1.5))
    # doors with hinges at leading edge
    doors = empty("doors_anchor")
    for name, x, y_center, y_span, sign in (("door_fl", -0.9, 0.15, 0.86, -1), ("door_fr", 0.9, 0.15, 0.86, 1)):
        d = box(name, (0.06, 0.72, y_span), (x, 0.78, y_center), material=paint)
        bevel(d, 0.035, 1)
        set_origin(d, (x, 0.78, y_center - (sign * y_span / 2)))
        parent(d, doors)
    for name, x, y_center, y_span, sign in (("door_rl", -0.88, -0.62, 0.78, -1), ("door_rr", 0.88, -0.62, 0.78, 1)):
        d = box(name, (0.06, 0.72, y_span), (x, 0.78, y_center), material=paint)
        bevel(d, 0.035, 1)
        set_origin(d, (x, 0.78, y_center - (sign * y_span / 2)))
        parent(d, doors)
    # NOTE: viewer looks for 'door_*' by name anywhere in the hierarchy
    trunk = box("trunk", (1.62, 0.68, 0.08), (0, 1.16, -1.82), material=paint)
    set_origin(trunk, (0, 1.5, -1.82))
    frunk = box("frunk", (1.56, 0.62, 0.06), (0, 0.72, 1.86), material=paint)
    set_origin(frunk, (0, 0.76, 2.2))
    return [body, windows, wheels, mirrors, hl, tl, interior, port, doors, trunk, frunk]


def build_sport_sedan(lod):
    paint = mat("paint", PAINT["sport_sedan"], metallic=0.6, roughness=0.22)
    trim = mat("trim", (0.08, 0.08, 0.09), roughness=0.8)
    glass = mat("glass", (0.04, 0.06, 0.08), roughness=0.1, transmission=0.85)
    seat = mat("seat", (0.12, 0.09, 0.1), roughness=0.85)
    dash = mat("dash", (0.06, 0.06, 0.07), roughness=0.65)
    body = empty("body")
    base = box("base", (1.86, 0.34, 4.15), (0, 0.32, 0.08), material=paint)
    bevel(base, 0.07, 2 if not lod else 1)
    nose = box("nose", (1.8, 0.22, 1.25), (0, 0.42, 2.45), material=paint)
    bevel(nose, 0.06, 2 if not lod else 1)
    cab = box("cab", (1.68, 0.38, 1.95), (0, 0.86, 0.16), material=paint)
    bevel(cab, 0.12, 2 if not lod else 1)
    spoiler = box("spoiler", (1.55, 0.06, 0.4), (0, 1.04, -1.95), (math.radians(-7), 0, 0), material=paint)
    bevel(spoiler, 0.02, 1)
    diffuser = box("diffuser", (1.4, 0.12, 0.4), (0, 0.2, -2.05), material=trim)
    for part in (base, nose, cab, spoiler, diffuser):
        parent(part, body)
    windows = empty("windows")
    for side in (-1, 1):
        w = box("window_glass", (0.03, 0.36, 1.4), (side * 0.84, 0.96, 0.18), material=glass)
        parent(w, windows)
    windshield = box("windshield", (1.58, 0.52, 0.05), (0, 1.0, 1.28), (math.radians(46), 0, 0), material=glass)
    parent(windshield, windows)
    rear = box("rear_window", (1.46, 0.3, 0.05), (0, 0.98, -1.3), (math.radians(-42), 0, 0), material=glass)
    parent(rear, windows)
    wheels = build_wheels(
        {"front": (1.42, 0.32, 0.84, 0.22), "rear": (-1.48, 0.32, 0.84, 0.22)},
        0.32, 0.26, trim, mat("rim", (0.2, 0.22, 0.24), metallic=0.9, roughness=0.2))
    mirrors = build_mirrors(paint, mat("mirror", (0.7, 0.85, 0.95), metallic=0.4, roughness=0.1))
    hl, tl = build_lamps(2.38, -2.2, 0.5, 1.78, 1.66, rear_z=0.86)
    spec = {
        "cab": {"y": 0},
        "seats": [
            ("seat_fl", (0.52, 0.12, 0.6), (-0.36, 0.62, 1.05), (0, 0, math.radians(-12))),
            ("seat_fr", (0.52, 0.12, 0.6), (0.36, 0.62, 1.05), (0, 0, math.radians(12))),
            ("seat_rear", (1.26, 0.1, 0.55), (0, 0.62, -0.28), (0, 0, 0)),
        ],
        "dash_size": (1.34, 0.1, 0.5),
        "dash_pos": (0, 0.74, 1.5),
        "wheel_pos": (0.36, 0.78, 1.32),
    }
    interior = build_interior(spec, seat, dash)
    port = build_charge({"charge_port": (-0.92, 0.68, -1.3, 0.24)}, paint, mat("connector", (0.1, 0.12, 0.14), emission=(0.13, 0.83, 0.93), emission_strength=1.5))
    doors = empty("doors_anchor")
    for name, x, y_center, y_span, sign in (("door_fl", -0.93, 0.42, 0.9, -1), ("door_fr", 0.93, 0.42, 0.9, 1)):
        d = box(name, (0.05, 0.6, y_span), (x, 0.66, y_center), material=paint)
        bevel(d, 0.03, 1)
        set_origin(d, (x, 0.66, y_center - (sign * y_span / 2)))
        parent(d, doors)
    for name, x, y_center, y_span, sign in (("door_rl", -0.91, -0.42, 0.72, -1), ("door_rr", 0.91, -0.42, 0.72, 1)):
        d = box(name, (0.05, 0.55, y_span), (x, 0.66, y_center), material=paint)
        bevel(d, 0.03, 1)
        set_origin(d, (x, 0.66, y_center - (sign * y_span / 2)))
        parent(d, doors)
    trunk = box("trunk", (1.62, 0.5, 0.08), (0, 0.98, -1.9), material=paint)
    set_origin(trunk, (0, 1.28, -1.9))
    frunk = box("frunk", (1.64, 0.72, 0.06), (0, 0.62, 2.34), material=paint)
    set_origin(frunk, (0, 0.66, 2.7))
    return [body, windows, wheels, mirrors, hl, tl, interior, port, doors, trunk, frunk]


def build_compact_crossover(lod):
    paint = mat("paint", PAINT["compact_crossover"], metallic=0.5, roughness=0.34)
    trim = mat("trim", (0.09, 0.1, 0.11), roughness=0.85)
    glass = mat("glass", (0.05, 0.07, 0.09), roughness=0.1, transmission=0.85)
    seat = mat("seat", (0.2, 0.18, 0.15), roughness=0.9)
    dash = mat("dash", (0.07, 0.07, 0.08), roughness=0.7)
    body = empty("body")
    base = box("base", (1.82, 0.5, 3.85), (0, 0.48, 0), material=paint)
    bevel(base, 0.09, 2 if not lod else 1)
    nose = box("nose", (1.76, 0.42, 0.6), (0, 0.62, 1.95), material=paint)
    bevel(nose, 0.07, 1)
    cab = box("cab", (1.68, 0.62, 2.1), (0, 1.18, -0.03), material=paint)
    bevel(cab, 0.12, 2 if not lod else 1)
    hatch = box("hatch", (1.66, 0.78, 0.45), (0, 1.26, -1.95), (math.radians(-14), 0, 0), material=paint)
    bevel(hatch, 0.06, 1)
    rails = empty("rails")
    for side in (-1, 1):
        r = box("roof_rail", (0.06, 0.07, 1.6), (side * 0.8, 1.62, -0.1), material=trim)
        parent(r, rails)
    cladding = box("cladding", (1.84, 0.16, 3.9), (0, 0.26, 0), material=trim)
    for part in (base, nose, cab, hatch, cladding):
        parent(part, body)
    windows = empty("windows")
    for side in (-1, 1):
        w = box("window_glass", (0.03, 0.46, 1.5), (side * 0.84, 1.28, 0), material=glass)
        parent(w, windows)
    windshield = box("windshield", (1.56, 0.66, 0.05), (0, 1.4, 1.06), (math.radians(34), 0, 0), material=glass)
    parent(windshield, windows)
    rear = box("rear_window", (1.5, 0.5, 0.05), (0, 1.36, -1.62), (math.radians(-18), 0, 0), material=glass)
    parent(rear, windows)
    wheels = build_wheels(
        {"front": (1.28, 0.37, 0.82, 0.22), "rear": (-1.28, 0.37, 0.82, 0.22)},
        0.37, 0.26, trim, mat("rim", (0.75, 0.77, 0.79), metallic=0.9, roughness=0.25))
    mirrors = build_mirrors(paint, mat("mirror", (0.7, 0.85, 0.95), metallic=0.4, roughness=0.1))
    hl, tl = build_lamps(2.0, -1.98, 0.72, 1.76, 1.66)
    spec = {
        "cab": {"y": 0},
        "seats": [
            ("seat_fl", (0.5, 0.12, 0.55), (-0.36, 0.86, 0.72), (0, 0, math.radians(-7))),
            ("seat_fr", (0.5, 0.12, 0.55), (0.36, 0.86, 0.72), (0, 0, math.radians(7))),
            ("seat_rear", (1.24, 0.12, 0.55), (0, 0.86, -0.5), (0, 0, 0)),
        ],
        "dash_size": (1.34, 0.12, 0.5),
        "dash_pos": (0, 1.0, 1.26),
        "wheel_pos": (0.36, 1.04, 1.08),
    }
    interior = build_interior(spec, seat, dash)
    port = build_charge({"charge_port": (-0.9, 0.9, -1.2, 0.24)}, paint, mat("connector", (0.1, 0.12, 0.14), emission=(0.13, 0.83, 0.93), emission_strength=1.5))
    doors = empty("doors_anchor")
    for name, x, y_center, y_span, sign in (("door_fl", -0.9, 0.2, 0.86, -1), ("door_fr", 0.9, 0.2, 0.86, 1)):
        d = box(name, (0.06, 0.86, y_span), (x, 0.92, y_center), material=paint)
        bevel(d, 0.035, 1)
        set_origin(d, (x, 0.92, y_center - (sign * y_span / 2)))
        parent(d, doors)
    for name, x, y_center, y_span, sign in (("door_rl", -0.88, -0.68, 0.78, -1), ("door_rr", 0.88, -0.68, 0.78, 1)):
        d = box(name, (0.06, 0.86, y_span), (x, 0.92, y_center), material=paint)
        bevel(d, 0.035, 1)
        set_origin(d, (x, 0.92, y_center - (sign * y_span / 2)))
        parent(d, doors)
    trunk = box("trunk", (1.66, 0.72, 0.08), (0, 1.32, -1.92), material=paint)
    set_origin(trunk, (0, 1.7, -1.92))
    frunk = box("frunk", (1.62, 0.56, 0.06), (0, 0.86, 1.84), material=paint)
    set_origin(frunk, (0, 0.9, 2.18))
    return [body, rails, windows, wheels, mirrors, hl, tl, interior, port, doors, trunk, frunk]


def build_suv(lod):
    paint = mat("paint", PAINT["suv"], metallic=0.5, roughness=0.36)
    trim = mat("trim", (0.08, 0.08, 0.09), roughness=0.85)
    glass = mat("glass", (0.05, 0.07, 0.09), roughness=0.1, transmission=0.85)
    seat = mat("seat", (0.14, 0.13, 0.12), roughness=0.9)
    dash = mat("dash", (0.06, 0.06, 0.07), roughness=0.7)
    body = empty("body")
    base = box("base", (1.94, 0.58, 4.35), (0, 0.6, 0), material=paint)
    bevel(base, 0.1, 2 if not lod else 1)
    nose = box("nose", (1.9, 0.52, 0.62), (0, 0.82, 2.2), material=paint)
    bevel(nose, 0.08, 2 if not lod else 1)
    cab = box("cab", (1.82, 0.85, 2.7), (0, 1.52, -0.12), material=paint)
    bevel(cab, 0.1, 2 if not lod else 1)
    hatch = box("hatch", (1.78, 0.82, 0.5), (0, 1.5, -2.25), (math.radians(-6), 0, 0), material=paint)
    bevel(hatch, 0.06, 1)
    rails = empty("rails")
    for side in (-1, 1):
        r = box("roof_rail", (0.07, 0.08, 1.9), (side * 0.85, 1.92, -0.1), material=trim)
        parent(r, rails)
    cladding = box("cladding", (1.96, 0.18, 4.4), (0, 0.32, 0), material=trim)
    skid = box("skid", (1.6, 0.06, 0.5), (0, 0.42, 2.4), material=trim)
    for part in (base, nose, cab, hatch, cladding, skid):
        parent(part, body)
    windows = empty("windows")
    for side in (-1, 1):
        w = box("window_glass", (0.03, 0.5, 1.9), (side * 0.9, 1.52, -0.05), material=glass)
        parent(w, windows)
    windshield = box("windshield", (1.68, 0.72, 0.05), (0, 1.66, 1.24), (math.radians(36), 0, 0), material=glass)
    parent(windshield, windows)
    rear = box("rear_window", (1.6, 0.55, 0.05), (0, 1.62, -1.85), (math.radians(-10), 0, 0), material=glass)
    parent(rear, windows)
    quarter = empty("quarter")
    for side in (-1, 1):
        q = box("quarter_window", (0.03, 0.4, 0.6), (side * 0.9, 1.52, -1.2), material=glass)
        parent(q, quarter)
    wheels = build_wheels(
        {"front": (1.38, 0.44, 0.88, 0.24), "rear": (-1.38, 0.44, 0.88, 0.24)},
        0.44, 0.3, trim, mat("rim", (0.24, 0.25, 0.27), metallic=0.9, roughness=0.22))
    mirrors = build_mirrors(paint, mat("mirror", (0.7, 0.85, 0.95), metallic=0.4, roughness=0.1))
    hl, tl = build_lamps(2.3, -2.22, 0.92, 1.9, 1.78, rear_z=1.1)
    spec = {
        "cab": {"y": 0},
        "seats": [
            ("seat_fl", (0.52, 0.12, 0.58), (-0.38, 1.06, 0.9), (0, 0, math.radians(-6))),
            ("seat_fr", (0.52, 0.12, 0.58), (0.38, 1.06, 0.9), (0, 0, math.radians(6))),
            ("seat_rl", (0.52, 0.12, 0.56), (-0.38, 1.06, -0.35), (0, 0, 0)),
            ("seat_rr", (0.52, 0.12, 0.56), (0.38, 1.06, -0.35), (0, 0, 0)),
            ("seat_rear", (1.3, 0.1, 0.55), (0, 1.02, -1.0), (0, 0, 0)),
        ],
        "dash_size": (1.44, 0.12, 0.55),
        "dash_pos": (0, 1.24, 1.5),
        "wheel_pos": (0.38, 1.28, 1.3),
    }
    interior = build_interior(spec, seat, dash)
    port = build_charge({"charge_port": (-0.95, 1.1, -1.3, 0.26)}, paint, mat("connector", (0.1, 0.12, 0.14), emission=(0.13, 0.83, 0.93), emission_strength=1.5))
    doors = empty("doors_anchor")
    for name, x, y_center, y_span, sign in (("door_fl", -0.95, 0.25, 1.0, -1), ("door_fr", 0.95, 0.25, 1.0, 1)):
        d = box(name, (0.07, 1.0, y_span), (x, 1.12, y_center), material=paint)
        bevel(d, 0.04, 1)
        set_origin(d, (x, 1.12, y_center - (sign * y_span / 2)))
        parent(d, doors)
    for name, x, y_center, y_span, sign in (("door_rl", -0.93, -0.8, 0.9, -1), ("door_rr", 0.93, -0.8, 0.9, 1)):
        d = box(name, (0.07, 1.0, y_span), (x, 1.12, y_center), material=paint)
        bevel(d, 0.04, 1)
        set_origin(d, (x, 1.12, y_center - (sign * y_span / 2)))
        parent(d, doors)
    trunk = box("trunk", (1.8, 0.86, 0.1), (0, 1.56, -2.18), material=paint)
    set_origin(trunk, (0, 2.0, -2.18))
    frunk = box("frunk", (1.76, 0.6, 0.06), (0, 1.04, 2.1), material=paint)
    set_origin(frunk, (0, 1.08, 2.46))
    return [body, rails, windows, quarter, wheels, mirrors, hl, tl, interior, port, doors, trunk, frunk]


def build_pickup(lod):
    paint = mat("paint", PAINT["pickup"], metallic=0.55, roughness=0.3)
    trim = mat("trim", (0.08, 0.08, 0.09), roughness=0.85)
    glass = mat("glass", (0.05, 0.07, 0.09), roughness=0.1, transmission=0.85)
    seat = mat("seat", (0.13, 0.12, 0.11), roughness=0.9)
    dash = mat("dash", (0.06, 0.06, 0.07), roughness=0.7)
    body = empty("body")
    base = box("base", (1.92, 0.5, 4.6), (0, 0.56, 0.1), material=paint)
    bevel(base, 0.08, 2 if not lod else 1)
    nose = box("nose", (1.86, 0.44, 0.7), (0, 0.72, 2.4), material=paint)
    bevel(nose, 0.07, 2 if not lod else 1)
    cab = box("cab", (1.78, 0.66, 1.35), (0, 1.28, 1.25), material=paint)
    bevel(cab, 0.09, 2 if not lod else 1)
    bed = box("bed", (1.78, 0.5, 1.9), (0, 0.84, -1.6), material=paint)
    bevel(bed, 0.04, 1)
    bed_rim = box("bed_rim", (1.8, 0.12, 1.72), (0, 1.18, -1.45), material=paint)
    fender_l = box("fender_l", (0.2, 0.35, 0.8), (-0.98, 0.72, 0.2), material=paint)
    bevel(fender_l, 0.05, 1)
    fender_r = box("fender_r", (0.2, 0.35, 0.8), (0.98, 0.72, 0.2), material=paint)
    bevel(fender_r, 0.05, 1)
    cladding = box("cladding", (1.94, 0.16, 4.65), (0, 0.3, 0.1), material=trim)
    skid = box("skid", (1.5, 0.06, 0.55), (0, 0.4, 2.62), material=trim)
    for part in (base, nose, cab, bed, bed_rim, fender_l, fender_r, cladding, skid):
        parent(part, body)
    windows = empty("windows")
    for side in (-1, 1):
        w = box("window_glass", (0.03, 0.42, 1.0), (side * 0.88, 1.4, 1.08), material=glass)
        parent(w, windows)
    windshield = box("windshield", (1.64, 0.64, 0.05), (0, 1.52, 1.8), (math.radians(38), 0, 0), material=glass)
    parent(windshield, windows)
    rear = box("rear_window", (1.5, 0.4, 0.05), (0, 1.42, 0.3), material=glass)
    parent(rear, windows)
    wheels = build_wheels(
        {"front": (1.44, 0.42, 0.86, 0.23), "rear": (-1.52, 0.42, 0.86, 0.23)},
        0.42, 0.3, trim, mat("rim", (0.22, 0.23, 0.25), metallic=0.9, roughness=0.25))
    mirrors = build_mirrors(paint, mat("mirror", (0.7, 0.85, 0.95), metallic=0.4, roughness=0.1))
    hl, tl = build_lamps(2.44, -2.35, 0.86, 1.86, 1.74, rear_z=0.9)
    spec = {
        "cab": {"y": 1.05},
        "seats": [
            ("seat_fl", (0.52, 0.12, 0.58), (-0.36, 0.92, 1.45), (0, 0, math.radians(-6))),
            ("seat_fr", (0.52, 0.12, 0.58), (0.36, 0.92, 1.45), (0, 0, math.radians(6))),
            ("seat_rear", (1.28, 0.1, 0.55), (0, 0.92, 0.7), (0, 0, 0)),
        ],
        "dash_size": (1.4, 0.12, 0.55),
        "dash_pos": (0, 1.08, 1.82),
        "wheel_pos": (0.36, 1.12, 1.64),
    }
    interior = build_interior(spec, seat, dash)
    port = build_charge({"charge_port": (-0.94, 1.0, 0.5, 0.26)}, paint, mat("connector", (0.1, 0.12, 0.14), emission=(0.13, 0.83, 0.93), emission_strength=1.5))
    doors = empty("doors_anchor")
    for name, x, y_center, y_span, sign in (("door_fl", -0.93, 1.3, 0.95, -1), ("door_fr", 0.93, 1.3, 0.95, 1)):
        d = box(name, (0.07, 0.92, y_span), (x, 1.06, y_center), material=paint)
        bevel(d, 0.04, 1)
        set_origin(d, (x, 1.06, y_center - (sign * y_span / 2)))
        parent(d, doors)
    for name, x, y_center, y_span, sign in (("door_rl", -0.91, 1.82, 0.85, -1), ("door_rr", 0.91, 1.82, 0.85, 1)):
        d = box(name, (0.07, 0.92, y_span), (x, 1.06, y_center), material=paint)
        bevel(d, 0.04, 1)
        set_origin(d, (x, 1.06, y_center - (sign * y_span / 2)))
        parent(d, doors)
    trunk = box("trunk", (1.62, 0.6, 0.1), (0, 1.3, 0.32), material=paint)
    set_origin(trunk, (0, 1.62, 0.32))
    frunk = box("frunk", (1.7, 0.62, 0.06), (0, 0.94, 2.3), material=paint)
    set_origin(frunk, (0, 0.98, 2.7))
    return [body, windows, wheels, mirrors, hl, tl, interior, port, doors, trunk, frunk]


BUILDERS = {
    "compact_sedan": build_compact_sedan,
    "sport_sedan": build_sport_sedan,
    "compact_crossover": build_compact_crossover,
    "suv": build_suv,
    "pickup": build_pickup,
}

REQUIRED_PARTS = [
    "body", "windows", "wheels", "mirrors", "interior",
    "door_fl", "door_fr", "door_rl", "door_rr", "trunk", "frunk",
    "charge_port", "charge_connector", "headlights", "taillights",
]


def collect_stats(objs):
    tris = 0
    verts = 0
    for o in objs:
        for child in o.children_recursive:
            if child.type == "MESH":
                verts += len(child.data.vertices)
                tris += sum(len(p.vertices) - 2 for p in child.data.polygons)
        if o.type == "MESH":
            verts += len(o.data.vertices)
            tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return verts, tris


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--class", dest="klass", required=True)
    ap.add_argument("--lod", action="store_true")
    ap.add_argument("--out", default="apps/web/public/assets/models")
    args = ap.parse_args(argv)

    if args.klass not in BUILDERS:
        print(f"unknown class {args.klass}", file=sys.stderr)
        sys.exit(2)

    global LOD
    LOD = args.lod
    clear_scene()
    objs = BUILDERS[args.klass](lod=args.lod)

    # Verify every required part exists somewhere in the hierarchy.
    names = set()
    for o in bpy.data.objects:
        names.add(o.name)
        names.update(c.name for c in o.children_recursive)
    missing = [p for p in REQUIRED_PARTS if p not in names]
    if missing:
        print(f"missing parts: {missing}", file=sys.stderr)
        sys.exit(3)

    # The vehicle is authored Y-up (height +Y, length +Z) — exactly the
    # glTF Y-up convention. Export with export_yup=False (identity mapping) so
    # no axis conversion distorts the model.
    bpy.ops.object.select_all(action="SELECT")
    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, f"{args.klass}{'_lod' if args.lod else ''}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=False,
    )
    verts, tris = collect_stats(bpy.data.objects)
    size = os.path.getsize(out_path)
    print(json.dumps({"class": args.klass, "lod": bool(args.lod), "file": out_path, "vertices": verts, "triangles": tris, "bytes": size}))


if __name__ == "__main__":
    main()
