#!/usr/bin/env python3
"""Bake body-fixed gameplay relief from the shipped maps, not a second terrain.

Earth uses the shipped GEBCO elevation/classification. The other body images
provide artistic luminance relief, not a DEM. The conspicuous Herschel bowl is
anchored to its visible location in the shipped Mimas mosaic. Run from the repo
root; Pillow and NumPy are build-time dependencies, never game dependencies.
"""
from pathlib import Path
import base64
import json
import math

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
TEXTURES = ROOT / "public" / "textures"
world = json.loads((ROOT / "shared" / "world.json").read_text())
moons = json.loads((ROOT / "shared" / "moons.json").read_text())
source_files = {
    "earth": "earth-terrain-8k.png", "mercury": "mercury-real.jpg",
    "mars": "mars-real-8k.jpg", "moon": "moon-real-8k.jpg",
    **{m["id"]: f'{m["id"]}-real.jpg' for m in moons
       if m["id"] not in {"moon", "naiad", "thalassa", "despina", "galatea", "larissa", "proteus", "nereid"}},
    **{key: "concept-asteroid.jpg" for key in ["naiad", "thalassa", "despina", "galatea", "larissa", "proteus"]},
    "nereid": "concept-haumea.jpg", "proxima-b": "concept-makemake.jpg",
    "proxima-c": "concept-venuslike.jpg", "proxima-d": "concept-ceres.jpg",
    **{f"barnard-{suffix}": f"barnard-{suffix}-8k.jpg" for suffix in ["d", "b", "c", "e"]},
}
offsets = dict(zip(["naiad", "thalassa", "despina", "galatea", "larissa", "proteus"], [0, .37, .61, .83, .17, .5]))
tilts = {"mercury": .034, "venus": 177.36, "earth": 23.44, "mars": 25.19, "ceres": 4}
tilts.update({m["id"]: 97.77 if m["parentId"] == "uranus" else 0 for m in moons})

def portable_data(values):
    return base64.b64encode(values.astype(np.uint8).tobytes()).decode("ascii")

def sphere_grid(width, height):
    u = (np.arange(width) + .5) / width
    v = (np.arange(height) + .5) / height
    lon, lat = np.meshgrid(u * 2 * math.pi, (v - .5) * math.pi)
    return np.stack([-np.cos(lon) * np.cos(lat), np.sin(lat), np.sin(lon) * np.cos(lat)], axis=-1)

def sphere_at(u, v):
    lon, lat = u * 2 * math.pi, (v - .5) * math.pi
    return np.array([-math.cos(lon) * math.cos(lat), math.sin(lat), math.sin(lon) * math.cos(lat)])

def pole_filter(values):
    # A pole has one radial direction. Keep it independent of arbitrary U, and
    # taper the first few rows so bilinear sampling has no longitude singularity.
    for end in [0, -1]:
        mean = float(np.mean(values[end]))
        values[end] = mean
        for step in range(1, 4):
            row = step if end == 0 else -1 - step
            blend = step / 4
            values[row] = mean * (1 - blend) + values[row] * blend
    return values

arrays, definitions = {}, {}
for body in world["bodies"]:
    key = body["id"]
    # Original fictional geology has its own stable generator shared by the CPU
    # and renderer; never replace it with an unrelated photo-derived field.
    if body.get("systemId") == "echo-rift":
        continue
    if body.get("kind") in {"star", "station", "black-hole"} or key in {"sun", "jupiter", "saturn", "uranus", "neptune"}:
        continue
    width, height = (1024, 512) if key == "earth" else (512, 256)
    source = source_files.get(key)
    source_id = source or f"procedural-{key}"
    craters = []
    if source_id not in arrays:
        if key == "earth":
            original = np.asarray(Image.open(TEXTURES / source).convert("L"), dtype=np.float32)
            elevation = np.maximum(original - 40, 0) / 215
            resized = Image.fromarray(elevation).resize((width, height), Image.Resampling.LANCZOS)
            values = np.clip(np.asarray(resized), 0, 1)[::-1].copy()
            classification = Image.fromarray((original == 0).astype(np.uint8) * 255).resize((width, height), Image.Resampling.BOX)
            water = (np.asarray(classification)[::-1] >= 128).astype(np.uint8)
            # Packed one-bit water mask distinguishes sea level land from water.
            mask = base64.b64encode(np.packbits(water.reshape(-1), bitorder="little").tobytes()).decode("ascii")
        elif source:
            gray = Image.open(TEXTURES / source).convert("L").resize((width, height), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(.45))
            luminance = np.asarray(gray, dtype=np.float32)[::-1].copy()
            lo, hi = np.percentile(luminance, [1, 99])
            values = np.clip((luminance - lo) / max(hi - lo, 1), 0, 1)
            mask = None
        else:
            # No photographic rocky surface exists for Venus or our procedural
            # Ceres model. Their one shared field contains the actual drawn pits.
            p = sphere_grid(width, height)
            seed = sum(map(ord, key)) * .17
            values = .55 + .08 * np.sin(p[..., 0] * 23 + seed) * np.cos(p[..., 2] * 19)
            rng = np.random.default_rng(sum(map(ord, key)))
            for index in range(56 if key == "ceres" else 28):
                u, v = float(rng.random()), float(math.asin(rng.uniform(-1, 1)) / math.pi + .5)
                radius = float(rng.uniform(.025, .14))
                t = np.arccos(np.clip(p @ sphere_at(u, v), -1, 1)) / radius
                bowl = np.clip(1 - t * t, 0, 1) ** 2
                rim = np.exp(-((t - 1) / .14) ** 2)
                values += -.34 * bowl + .09 * rim
                if index < 3:
                    craters.append({"id": f"{key}-crater-{index}", "uv": [u, v], "angularRadius": radius})
            values = np.clip(values, 0, 1)
            mask = None
        if key == "mimas":
            # Measured on the shipped image, rather than relying on a different
            # prime-meridian convention: its large visible Herschel ring remains
            # a depression when approached. Depth here is artistic/gameplay.
            crater = {"id": "herschel", "uv": [.155, .5], "angularRadius": .335}
            craters.append(crater)
            p = sphere_grid(width, height)
            t = np.arccos(np.clip(p @ sphere_at(*crater["uv"]), -1, 1)) / crater["angularRadius"]
            floor = .16 + .06 * values + .27 * np.clip(t, 0, 1) ** 2
            rim = .22 * np.exp(-((t - 1) / .12) ** 2)
            # The replacement is local to the photo's bowl; its perimeter blends
            # into the rest of the same image-derived field with zero endpoint slope.
            blend = np.clip((1.16 - t) / .25, 0, 1)
            blend = blend * blend * (3 - 2 * blend)
            values = values * (1 - blend) + (floor + rim) * blend
        values = pole_filter(values)
        encoded = np.rint(np.clip(values, 0, 1) * 255).astype(np.uint8)
        arrays[source_id] = {"width": width, "height": height, "data": portable_data(encoded), **({"waterMask": mask} if mask else {})}
    radius_km = body["radius"] * world["unitsKm"]
    definitions[key] = {
        "id": key, "sourceId": source_id,
        "heightOffsetKm": 0 if key == "earth" else .065,
        "heightScaleKm": 6371 * .00142 if key == "earth" else min(6, radius_km * .015),
        "tiltRad": math.radians(tilts.get(key, 0)),
        "yawRad": -1.8 if key == "earth" else -.4,
        "mapOffset": offsets.get(key, 0),
        "fineSeed": sum(map(ord, key)) * .17,
        "fineEnabled": key != "earth",
        **({"craters": craters} if craters else {}),
    }

output = """// Generated by scripts/prepare-canonical-terrain.py. Do not edit raster bytes.
// Earth: GEBCO-derived elevation. Other body images: artistic luminance relief, not DEMs.
// Shared source images share one decoded raster; body frame/scale remains independent.
const rasterDefinitions = """ + json.dumps(arrays, separators=(",", ":")) + ";\n"
output += "export const terrainDefinitions = " + json.dumps(definitions, separators=(",", ":")) + ";\n"
output += """const rasterCache = new Map();
const fieldCache = new Map();
function bytes(encoded) {
  const binary = atob(encoded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
export function getTerrainHeightField(id) {
  const definition = terrainDefinitions[id];
  if (!definition) return undefined;
  if (fieldCache.has(id)) return fieldCache.get(id);
  const sourceId = definition.sourceId;
  let raster = rasterCache.get(sourceId);
  if (!raster) {
    const encoded = rasterDefinitions[sourceId];
    raster = { width: encoded.width, height: encoded.height, data: bytes(encoded.data) };
    if (encoded.waterMask) {
      const packed = bytes(encoded.waterMask);
      raster.waterMask = Uint8Array.from({length: encoded.width * encoded.height}, (_, i) => ((packed[i >> 3] >> (i & 7)) & 1) * 255);
    }
    rasterCache.set(sourceId, raster);
  }
  const field = Object.freeze({...definition, ...raster});
  fieldCache.set(id, field);
  return field;
}
"""
(ROOT / "shared" / "terrain-fields.mjs").write_text(output)
print(f"Generated {len(definitions)} body fields / {len(arrays)} shared rasters ({len(output):,} source bytes)")
