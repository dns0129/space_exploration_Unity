"""Native spherical Barnard artwork; no surface or stellar imaging is claimed.

Python + NumPy + SciPy + Pillow. All fields are evaluated on the unit sphere
at 8192 x 4096, including crater bowls, ejecta, minerals and fine granulation.
The 4K alternate is filtered from this native output, never enlarged. There
are no baked directional shadows: the game's shared relief shader supplies
lighting from the host star. Seeds and dimensions are recorded in provenance.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
TEXTURES = ROOT / "public/textures"
SEEDS = {"star": 3195185, "b": 202610091, "c": 202610092, "d": 202610093, "e": 202610094}
# High-albedo silicate regolith and darker basaltic units are artistic choices.
PALETTES = {
    "b": ([.72, .64, .53], [.27, .25, .23], [.80, .73, .63]),
    "c": ([.58, .60, .62], [.23, .24, .27], [.75, .76, .76]),
    "d": ([.73, .56, .41], [.31, .25, .21], [.84, .71, .57]),
    "e": ([.76, .73, .67], [.35, .32, .31], [.87, .84, .77]),
}


def smooth(lo, hi, value):
    value = np.clip((value - lo) / (hi - lo), 0, 1)
    return value * value * (3 - 2 * value)


def noise(p, scale, seed):
    """Smooth seeded 3D lattice field, continuous across longitude and poles."""
    point = p * np.float32(scale) + np.float32(seed)
    cell = np.floor(point).astype(np.int32)
    f = point - cell
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


def centres(rng, count):
    value = rng.normal(size=(count, 3)).astype(np.float32)
    return value / np.linalg.norm(value, axis=1)[:, None]


class Craters:
    def __init__(self, rng, count, low, high):
        self.tree = cKDTree(centres(rng, count))
        self.radius = np.exp(rng.uniform(np.log(low), np.log(high), count)).astype(np.float32)
        self.age = rng.uniform(.35, 1, count).astype(np.float32)

    def sample(self, p):
        distance, indices = self.tree.query(p.reshape(-1, 3), k=3)
        ratio = (distance / self.radius[indices]).reshape(*p.shape[:-1], 3)
        age = self.age[indices].reshape(*p.shape[:-1], 3)
        # Neutral albedo of shadow-free crater bowls, bright rims and faded ejecta.
        bowl = (1 - smooth(.12, .94, ratio)) * age
        rim = np.exp(-((ratio - 1) * 11) ** 2) * age
        ejecta = np.exp(-((ratio - 1.18) * 2.4) ** 2) * age
        return (np.max(bowl, axis=-1), np.max(rim, axis=-1), np.max(ejecta, axis=-1))


def generate_rock(body, width):
    rng = np.random.default_rng(SEEDS[body])
    populations = [Craters(rng, 65, .055, .18), Craters(rng, 950, .009, .039), Craters(rng, 15000, .0017, .008)]
    highland, plain, fresh = [np.asarray(value, dtype=np.float32) for value in PALETTES[body]]
    height = width // 2
    image = np.empty((height, width, 3), dtype=np.uint8)
    longitude = np.linspace(-np.pi, np.pi, width, endpoint=False, dtype=np.float32)
    latitude = np.linspace(np.pi/2, -np.pi/2, height, dtype=np.float32)
    for start in range(0, height, 32):
        stop = min(height, start + 32)
        lat = latitude[start:stop, None]
        p = np.stack(np.broadcast_arrays(np.cos(lat)*np.cos(longitude), np.sin(lat), np.cos(lat)*np.sin(longitude)), axis=-1)
        seed = (SEEDS[body] % 997) / 7
        # Warp the broad mineral domains before the fractal sum. This removes
        # the lattice's rectangular silhouettes without altering map topology.
        warp = np.stack([noise(p, 8.3, seed+offset)-.5 for offset in (17, 43, 67)], axis=-1)
        geology = p + warp*.22
        continent = noise(geology, 4.7, seed)*.54 + noise(geology, 12.9, seed+19)*.3 + noise(geology, 33, seed+37)*.16
        unit = noise(geology, 13.5, seed + 31)
        middle = noise(p, 48, seed + 77)
        coarse = noise(p, 173, seed + 111)
        grain = noise(p, 710, seed + 139) * .65 + noise(p, 1910, seed + 151) * .35
        # Irregular basaltic terrain, bounded by mineral transitions rather than coastlines.
        dark = smooth(.48, .67, continent * .72 + unit * .28)
        if body == "c": dark = smooth(.44, .63, continent * .62 + unit * .38)
        if body == "e": dark *= .76
        colour = highland * (1-dark[..., None]) + plain * dark[..., None]
        colour *= (.81 + middle * .23 + coarse * .13 + (grain-.5) * .15)[..., None]
        # Multiscale geological lineaments and granular mineral exposures.
        fault = (1-smooth(.007, .035, np.abs(unit-.52))) * smooth(.37, .6, continent)
        colour *= (1-fault * .11)[..., None]
        for index, population in enumerate(populations):
            bowl, rim, ejecta = population.sample(p)
            strength = [.26, .20, .13][index]
            colour *= (1-bowl * strength)[..., None]
            exposure = (rim * .19 + ejecta * .055) * (1-dark*.4)
            colour = colour*(1-exposure[..., None]) + fresh*exposure[..., None]
        image[start:stop] = np.clip(colour * 255, 0, 255).astype(np.uint8)
        if start % 512 == 0:
            print(f"barnard-{body} native spherical relief: {start*100//height}%", flush=True)
    return Image.fromarray(image)


def generate_star(width):
    rng = np.random.default_rng(SEEDS["star"])
    granules = cKDTree(centres(rng, 118000))
    warmth = rng.uniform(.91, 1.06, len(granules.data)).astype(np.float32)
    # A quiet, old red dwarf: sparse cool magnetic regions, no persistent flare spectacle.
    spots = centres(rng, 17)
    spot_radii = rng.uniform(.015, .047, len(spots))
    height = width // 2
    image = np.empty((height, width), dtype=np.uint8)
    longitude = np.linspace(-np.pi, np.pi, width, endpoint=False, dtype=np.float32)
    latitude = np.linspace(np.pi/2, -np.pi/2, height, dtype=np.float32)
    for start in range(0, height, 32):
        stop = min(height, start+32)
        lat = latitude[start:stop, None]
        p = np.stack(np.broadcast_arrays(np.cos(lat)*np.cos(longitude), np.sin(lat), np.cos(lat)*np.sin(longitude)), axis=-1)
        # Deform the cell domain continuously on the sphere: organic convective
        # outlines instead of straight Voronoi edges or a visible polygon grid.
        warp = np.stack([noise(p, 105, seed)-.5 for seed in (113, 137, 163)], axis=-1)
        distorted = p + warp * .006
        distorted /= np.linalg.norm(distorted, axis=-1)[..., None]
        distance, indices = granules.query(distorted.reshape(-1, 3), k=2)
        distance = distance.reshape(stop-start, width, 2)
        indices = indices[:, 0].reshape(stop-start, width)
        # Narrow descending lanes surround warm irregular photospheric granules.
        gap = (distance[..., 1]-distance[..., 0]) / .003
        lanes = smooth(0, 1, gap)
        convection = noise(p, 17, 53)
        fine = noise(p, 950, 79) * .7 + noise(p, 2300, 103) * .3
        brightness = (.58 + lanes*.22 + convection*.14 + (fine-.5)*.075) * warmth[indices]
        for spot, radius in zip(spots, spot_radii):
            distance = np.linalg.norm(p-spot, axis=-1)/radius
            penumbra = 1-smooth(.72, 1.28, distance)
            umbra = 1-smooth(.36, .73, distance)
            brightness *= 1-penumbra*.13-umbra*.25
        image[start:stop] = np.clip(brightness*255, 0, 255).astype(np.uint8)
        if start % 512 == 0:
            print(f"barnard-star native spherical granulation: {start*100//height}%", flush=True)
    return Image.fromarray(image)


def save(body, full, width):
    updates = {}
    for output_width in [width, width//2]:
        suffix = "8k" if output_width == 8192 else "4k" if output_width == 4096 else f"{output_width}px"
        name = f"barnard-{body}-{suffix}.jpg"
        output = TEXTURES / name
        texture = full if output_width == width else full.resize((output_width, output_width//2), Image.Resampling.LANCZOS)
        texture.save(output, quality=90, subsampling=2, optimize=True)
        updates[name] = {
            "source": "scripts/generate-barnard-textures.py",
            "credit": "Voyager project original procedural artwork (2026)",
            "license": "CC0-1.0", "kind": "concept",
            "changes": "Native spherical 8K granulation/spot field" if body == "star" else "Native spherical 8K shadow-free mineral, impact-basin and multiscale crater field",
            "processing": "4K alternate filtered with Lanczos; JPEG quality 90, grayscale photosphere / chroma 4:2:0 minerals; not upscaled",
            "seed": SEEDS[body], "width": output_width, "height": output_width//2,
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        }
        print(f"Saved {name}: {output_width} x {output_width//2}, {output.stat().st_size/1024/1024:.1f} MiB", flush=True)
    # Re-read immediately before merging so other independent asset metadata is preserved.
    manifest_path = TEXTURES / "provenance.json"
    manifest = json.loads(manifest_path.read_text())
    manifest.update(updates)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bodies", nargs="+", choices=list(SEEDS), default=list(SEEDS))
    parser.add_argument("--width", type=int, default=8192)
    args = parser.parse_args()
    if args.width != 8192:
        parser.error("Published assets must be generated directly at their native 8192-pixel width")
    for body in args.bodies:
        full = generate_star(args.width) if body == "star" else generate_rock(body, args.width)
        save(body, full, args.width)
