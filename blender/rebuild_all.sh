#!/usr/bin/env bash
# VoltLink Blender asset pipeline — rebuild all vehicle GLBs + thumbnails.
# Fails the build if Blender is missing or any asset is invalid.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLENDER_BIN="${BLENDER:-$HOME/.local/bin/blender}"
OUT_DIR="$REPO_ROOT/apps/web/public/assets/models"
SCRIPTS="$REPO_ROOT/blender/scripts"
THUMBS="$OUT_DIR/thumbs"
CLASSES=(compact_sedan sport_sedan compact_crossover suv pickup)

if ! command -v "$BLENDER_BIN" >/dev/null 2>&1; then
  echo "ERROR: Blender not found at $BLENDER_BIN (set BLENDER=/path/to/blender)" >&2
  exit 1
fi

BLENDER_VERSION="$("$BLENDER_BIN" --version 2>/dev/null | head -1)"
echo "Blender: $BLENDER_VERSION"

mkdir -p "$OUT_DIR" "$THUMBS"
STATS_FILE="$OUT_DIR/.stats.jsonl"
: > "$STATS_FILE"

for cls in "${CLASSES[@]}"; do
  for variant in "" "_lod"; do
    if [[ -n "$variant" ]]; then
      "$BLENDER_BIN" -b -P "$SCRIPTS/generate_vehicle.py" -- --class "$cls" --lod --out "$OUT_DIR" >> "$STATS_FILE"
    else
      "$BLENDER_BIN" -b -P "$SCRIPTS/generate_vehicle.py" -- --class "$cls" --out "$OUT_DIR" >> "$STATS_FILE"
    fi
  done
  "$BLENDER_BIN" -b -P "$SCRIPTS/render_thumb.py" -- --glb "$OUT_DIR/$cls.glb" --out "$THUMBS/$cls.png" >/dev/null
done

# Manifest
python3 - "$OUT_DIR" <<'PYEOF'
import json, os, sys
out = sys.argv[1]
assets = []
for line in open(os.path.join(out, ".stats.jsonl")):
    line = line.strip()
    if not line.startswith("{"):
        continue
    assets.append(json.loads(line))
for a in assets:
    a["file"] = os.path.basename(a["file"])
manifest = {"generator": "blender/scripts/generate_vehicle.py", "classes": ["compact_sedan","sport_sedan","compact_crossover","suv","pickup"], "assets": sorted(assets, key=lambda a: a["file"])}
with open(os.path.join(out, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)
PYEOF
rm -f "$STATS_FILE"

# Validation (required parts, container structure, thumbnails)
python3 "$SCRIPTS/validate_assets.py" --dir "$OUT_DIR"

# Report
echo ""
echo "=== Asset report ==="
python3 - "$OUT_DIR" <<'PYEOF'
import json, os, sys
m = json.load(open(os.path.join(sys.argv[1], "manifest.json")))
tot = 0
for a in m["assets"]:
    kb = a["bytes"] / 1024
    tot += a["bytes"]
    print(f"  {a['file']:24s} {kb:9.1f} KiB  verts={a['vertices']:>7,} tris={a['triangles']:>7,}")
print(f"  total: {tot/1024/1024:.2f} MiB across {len(m['assets'])} GLB assets")
PYEOF
echo "OK: all assets generated and validated."
