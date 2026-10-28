# Render a thumbnail for a generated vehicle GLB (Blender headless).
# Usage: blender -b -P render_thumb.py -- --glb <file> --out <png>
#
# Uses an orthographic camera with a Track To constraint on the vehicle, so
# framing is deterministic and independent of perspective math.

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector


def frame_imported():
    bounds = None
    for o in bpy.context.scene.objects:
        if o.type != "MESH":
            continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            if bounds is None:
                bounds = [Vector(w), Vector(w)]
            else:
                for i in range(3):
                    bounds[0][i] = min(bounds[0][i], w[i])
                    bounds[1][i] = max(bounds[1][i], w[i])
    if bounds is None:
        return None
    center = (bounds[0] + bounds[1]) / 2
    size = max(bounds[1].x - bounds[0].x, bounds[1].y - bounds[0].y, bounds[1].z - bounds[0].z)
    return center, max(size, 0.001)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--glb", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=args.glb)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 288
    scene.render.film_transparent = True

    framed = frame_imported()
    if framed is None:
        print("no geometry to frame", file=sys.stderr)
        sys.exit(2)
    center, size = framed

    cam_data = bpy.data.cameras.new("thumb_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.9
    cam = bpy.data.objects.new("thumb_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = center + Vector((0.85, 0.4, 0.18)).normalized() * (size * 3)
    direction = center - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    sun_data = bpy.data.lights.new("thumb_sun", "SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("thumb_sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(55), 0, math.radians(-35))

    fill_data = bpy.data.lights.new("thumb_fill", "SUN")
    fill_data.energy = 1.2
    fill = bpy.data.objects.new("thumb_fill", fill_data)
    scene.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(20), 0, math.radians(140))

    # The glTF import leaves the view layer dirty: without an explicit
    # update, object transforms stay stale (matrix_world = identity) and the
    # camera renders from inside the model.
    bpy.context.view_layer.update()

    world = bpy.data.worlds.new("thumb_world")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.10, 0.13, 0.16, 1.0)
    bg.inputs[1].default_value = 1.0
    scene.world = world

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    scene.render.filepath = args.out
    bpy.ops.render.render(write_still=True)
    print(f"thumb: {args.out}")


if __name__ == "__main__":
    main()
