"""Original spherical red-supergiant artwork; not an observed Betelgeuse map.

Run with Python, NumPy, Pillow and SciPy. The seeded 3D field is continuous at
the longitude seam and poles. Evaluate the detail directly at 8192 x 4096;
the separate 4K asset is a filtered copy, never an upscaled low-resolution map.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 8192, 4096


def lattice_noise(p, scale, seed):
    p = p * scale + seed
    cell = np.floor(p).astype(np.int32)
    f = p - cell
    f = f * f * (3 - 2 * f)
    result = np.zeros(p.shape[:-1], dtype=np.float32)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                c = (cell + [dx, dy, dz]).astype(np.uint32)
                h = c[..., 0] * np.uint32(374761393) + c[..., 1] * np.uint32(668265263) + c[..., 2] * np.uint32(2246822519)
                h = (h ^ (h >> 13)) * np.uint32(1274126177)
                h ^= h >> 16
                weight = (f[..., 0] if dx else 1-f[..., 0]) * (f[..., 1] if dy else 1-f[..., 1]) * (f[..., 2] if dz else 1-f[..., 2])
                result += (h.astype(np.float32) / np.float32(4294967295)) * weight
    return result


rng = np.random.default_rng(20261004)
centres = rng.normal(size=(58, 3))
centres /= np.linalg.norm(centres, axis=1)[:, None]
tree = cKDTree(centres)
cell_heat = rng.uniform(0.75, 1.13, len(centres))
longitude = np.linspace(-np.pi, np.pi, WIDTH, endpoint=False, dtype=np.float32)
image = np.empty((HEIGHT, WIDTH, 3), dtype=np.uint8)
for start in range(0, HEIGHT, 32):
    end = min(start + 32, HEIGHT)
    latitude = np.linspace(np.pi/2, -np.pi/2, HEIGHT, dtype=np.float32)[start:end, None]
    p = np.stack(np.broadcast_arrays(np.cos(latitude)*np.cos(longitude), np.sin(latitude), np.cos(latitude)*np.sin(longitude)), axis=-1)
    warp = np.stack([lattice_noise(p, 8, seed)-0.5 for seed in (11, 23, 37)], axis=-1)
    distorted = p + warp * 0.14
    distorted /= np.linalg.norm(distorted, axis=-1)[..., None]
    distances, indices = tree.query(distorted.reshape(-1, 3), k=2)
    distances = distances.reshape(end-start, WIDTH, 2)
    indices = indices[:, 0].reshape(end-start, WIDTH)
    gap = np.clip((distances[..., 1]-distances[..., 0])/0.075, 0, 1)
    lanes = gap * gap * (3-2*gap)
    turbulence = lattice_noise(p, 28, 53) * 0.65 + lattice_noise(p, 65, 71) * 0.35
    granules = sum(lattice_noise(p, scale, seed)*weight for scale, seed, weight in [(140,89,.4),(310,103,.3),(680,127,.2),(1450,151,.1)])
    heat = np.clip((0.32 + lanes*0.42 + turbulence*0.22 + (granules-0.5)*0.23) * cell_heat[indices], 0, 1)
    # Broad cooler orange-red lanes surround the hot gold centres of convection cells.
    red = np.clip(0.53 + heat*0.47, 0, 1)
    green = np.clip(0.11 + heat**1.5*0.7, 0, 1)
    blue = np.clip(0.026 + heat**2.1*0.31, 0, 1)
    image[start:end] = np.stack([red,green,blue], axis=-1)*255
    if start % 512 == 0:
        print(f"Native 8K convection: {start*100//HEIGHT}%", flush=True)

full = Image.fromarray(image)
manifest_path = ROOT / "public/textures/provenance.json"
manifest = json.loads(manifest_path.read_text())
for width, name in [(8192, "betelgeuse-8k.jpg"), (4096, "betelgeuse-4k.jpg")]:
    output = ROOT / "public/textures" / name
    texture = full if width == WIDTH else full.resize((width, width//2), Image.Resampling.LANCZOS)
    texture.save(output, quality=92, subsampling=0, optimize=True)
    manifest[name] = {
        "source": "scripts/generate-betelgeuse-texture.py",
        "credit": "Voyager project original procedural artwork (2026)",
        "license": "CC0-1.0",
        "kind": "concept",
        "changes": "Native spherical 8K convection field; 4K alternate filtered with Lanczos; JPEG quality 92",
        "width": width,
        "height": width//2,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    }
    print(f"Saved {name}: {width} x {width//2}, {output.stat().st_size/1024/1024:.1f} MiB", flush=True)
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n")
