#!/usr/bin/env python3
"""Validate generated VoltLink GLB assets without Blender.

Checks:
  - GLB container structure (magic, version, chunk layout)
  - required named parts present in the glTF node graph
  - manifest.json matches the directory contents
  - thumbnails exist for every class
Exit code 0 when everything is valid; non-zero otherwise.
"""

import argparse
import json
import os
import struct
import sys

REQUIRED_PARTS = [
    "body", "windows", "wheels", "mirrors", "interior",
    "door_fl", "door_fr", "door_rl", "door_rr", "trunk", "frunk",
    "charge_port", "charge_connector", "headlights", "taillights",
]

CLASSES = ["compact_sedan", "sport_sedan", "compact_crossover", "suv", "pickup"]


def parse_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    if len(data) < 12:
        raise ValueError("file too small")
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:  # 'glTF'
        raise ValueError("bad magic")
    if version != 2:
        raise ValueError(f"unsupported glTF version {version}")
    if length != len(data):
        raise ValueError("length mismatch")
    # JSON chunk
    chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != 0x4E4F534A:  # 'JSON'
        raise ValueError("first chunk is not JSON")
    raw_json = data[20:20 + chunk_len]
    doc = json.loads(raw_json)
    return doc, chunk_len


def node_names(doc):
    names = set()
    for node in doc.get("nodes", []):
        names.add(node.get("name", ""))
    return names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="apps/web/public/assets/models")
    args = ap.parse_args()

    errors = []
    manifest_path = os.path.join(args.dir, "manifest.json")
    if not os.path.isfile(manifest_path):
        errors.append("manifest.json missing")
        manifest = None
    else:
        with open(manifest_path) as f:
            manifest = json.load(f)

    entries = {}
    for klass in CLASSES:
        for suffix in ("", "_lod"):
            path = os.path.join(args.dir, f"{klass}{suffix}.glb")
            if not os.path.isfile(path):
                errors.append(f"missing asset {path}")
                continue
            try:
                doc, _ = parse_glb(path)
                names = node_names(doc)
                missing = [p for p in REQUIRED_PARTS if p not in names]
                if missing:
                    errors.append(f"{klass}{suffix}.glb missing parts: {missing}")
                entries[f"{klass}{suffix}"] = {
                    "bytes": os.path.getsize(path),
                    "nodes": len(doc.get("nodes", [])),
                    "meshes": len(doc.get("meshes", [])),
                    "materials": len(doc.get("materials", [])),
                }
            except (ValueError, json.JSONDecodeError, struct.error) as e:
                errors.append(f"{klass}{suffix}.glb invalid: {e}")
        thumb = os.path.join(args.dir, "thumbs", f"{klass}.png")
        if not os.path.isfile(thumb):
            errors.append(f"missing thumbnail {thumb}")

    if manifest is not None:
        man_assets = {a.get("file") for a in manifest.get("assets", [])}
        want = {f"{k}{s}.glb" for k in CLASSES for s in ("", "_lod")}
        diff = want - man_assets
        if diff:
            errors.append(f"manifest missing entries: {sorted(diff)}")

    if errors:
        for e in errors:
            print(f"FAIL {e}", file=sys.stderr)
        sys.exit(1)

    print(f"OK  {len(CLASSES)} classes, {len(entries)} GLB assets validated")
    for name, info in sorted(entries.items()):
        print(f"  {name:22s} {info['bytes']:>9,} bytes  {info['nodes']} nodes  {info['meshes']} meshes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
