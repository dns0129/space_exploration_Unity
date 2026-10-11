"""Download, verify and prepare the planet, moon and Alpha Centauri surface maps.

Development-only asset tool: Python, NumPy and Pillow. Every source is pinned to a
Git revision and SHA-256. The game loads the saved JPEG files and needs no Python.
Usage: python3 scripts/prepare-body-textures.py [cache-directory] [output-file ...]
"""
from pathlib import Path
import hashlib
import io
import json
import sys
import tempfile
import urllib.request
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public/textures"
CACHE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.gettempdir()) / "voyager-texture-sources"
Image.MAX_IMAGE_PIXELS = None

CELESTIA = "https://raw.githubusercontent.com/CelestiaProject/CelestiaContent/57daa0d8d33d4799a721c496de62f019e335f625/textures/"
CELESTIA_PAGE = "https://github.com/CelestiaProject/CelestiaContent/blob/57daa0d8d33d4799a721c496de62f019e335f625/textures/"
SSS_MIRROR = "https://raw.githubusercontent.com/Whitebee7/solarsystem/235e72c02e825e0c8d0792ec0aa6be43e1a14f68/textures/"
SSS_MIRROR_PAGE = "https://github.com/Whitebee7/solarsystem/blob/235e72c02e825e0c8d0792ec0aa6be43e1a14f68/textures/"
SSS_8K = "https://raw.githubusercontent.com/renoultdavid/textures/68b6d34056efb1065207f0b5e139d5998cc0a575/"
SSS_8K_PAGE = "https://github.com/renoultdavid/textures/blob/68b6d34056efb1065207f0b5e139d5998cc0a575/"
SSS_4K = "https://raw.githubusercontent.com/7ohnkuu/universe/200f5667391eb512a032e20b00bf41887eadc2b9/textures/"
SSS_4K_PAGE = "https://github.com/7ohnkuu/universe/blob/200f5667391eb512a032e20b00bf41887eadc2b9/textures/"
SSS = "Solar System Scope"
# Celestia legacy maps without an SPDX .license file; README credits listed per body.
LEGACY = "Celestia Content legacy texture (no per-file SPDX file; distributed with Celestia under GPL-2.0-or-later; NASA/JPL imagery under the JPL Image Use Policy)"

# file: (download URL, page URL, source SHA-256, credit, license, kind, operation)
# kind: observed | concept. operation keys: width (resize), quality (JPEG), gray, fill (unimaged hemisphere).
SOURCES = {
    "mercury-real.jpg": (SSS_4K + "4k_mercury.jpg", SSS_4K_PAGE + "4k_mercury.jpg",
        "7501d48c5a2ca7f2fbb71db1f7af1b3959e5c178fc75e63146e57e4087cb45c1", SSS + " (8k_mercury.jpg downscaled to 4096 px by the mirror)", "CC-BY-4.0", "observed", {"quality": 85}),
    "venus-real.jpg": (SSS_8K + "Solarsystemscope_texture_4k_venus_atmosphere.jpg", SSS_8K_PAGE + "Solarsystemscope_texture_4k_venus_atmosphere.jpg",
        "a14aeba3c6ad7a56f989bb32008dec548077aeded420495b34df98f2dc14ba91", SSS + " (4k_venus_atmosphere.jpg)", "CC-BY-4.0", "observed", {"quality": 85}),
    "mars-real.jpg": (SSS_8K + "Mars.jpg", SSS_8K_PAGE + "Mars.jpg",
        "4cc52149924abc6ae507d63032f994e1d42a55cb82c09e002d1a567ff66c23ee", SSS + " (8k_mars.jpg, byte-identical upstream)", "CC-BY-4.0", "observed", {"width": 4096, "quality": 85}),
    "mars-real-8k.jpg": (SSS_8K + "Mars.jpg", SSS_8K_PAGE + "Mars.jpg",
        "4cc52149924abc6ae507d63032f994e1d42a55cb82c09e002d1a567ff66c23ee", SSS + " (8k_mars.jpg, byte-identical upstream)", "CC-BY-4.0", "observed", {"quality": 90}),
    "uranus-real.jpg": (SSS_MIRROR + "2k_uranus.jpg", SSS_MIRROR_PAGE + "2k_uranus.jpg",
        "d15239d46f82d3ea13d2b260b5b29b2a382f42f2916dae0694d0387b1204a09d", SSS + " (2k_uranus.jpg; no larger openly licensed map)", "CC-BY-4.0", "observed", {"quality": 85}),
    "moon-real.jpg": (SSS_8K + "lune.jpg", SSS_8K_PAGE + "lune.jpg",
        "d1875bcec83588ca25e4802e576f6bb9f88b39e1e403cb41ff55867419c54796", SSS + " (8k_moon.jpg, byte-identical upstream)", "CC-BY-4.0", "observed", {"width": 4096, "quality": 85}),
    "moon-real-8k.jpg": (SSS_8K + "lune.jpg", SSS_8K_PAGE + "lune.jpg",
        "d1875bcec83588ca25e4802e576f6bb9f88b39e1e403cb41ff55867419c54796", SSS + " (8k_moon.jpg, byte-identical upstream)", "CC-BY-4.0", "observed", {"quality": 90}),
    "io-real.jpg": (CELESTIA + "hires/io.png", CELESTIA_PAGE + "hires/io.png",
        "7c06333e3a738cb0921877c7d8be51a0ec42a6a72c9199d9b56377889cb132c4", "ItzImcool; NASA/JPL-Caltech/ASI/USGS; NASA/JPL/SwRI/MSSS/Gerald Eichstädt/Jason Perry/John Rogers; AstroChara", "CC-BY-4.0", "observed", {"quality": 85}),
    "europa-real.jpg": (CELESTIA + "hires/europa.jpg", CELESTIA_PAGE + "hires/europa.jpg",
        "3dccd0cc9909a03acc80efceb5bdc699d8aec9298a900920ae616fdcd29edc55", "John van Vliet; NASA/JPL Galileo and Voyager imagery", LEGACY, "observed", {"quality": 85}),
    "ganymede-real.jpg": (CELESTIA + "hires/ganymede.jpg", CELESTIA_PAGE + "hires/ganymede.jpg",
        "0f2aee3be112d66d5d7d814b75e7ed3305db3c719aa427b5a112884a36a360cd", "Askaniy Anpilogov; NASA/JPL-Caltech/ASI/USGS; NASA/JPL-Caltech/Björn Jónsson; NASA/JPL-Caltech/SwRI/MSSS/Brian Swift", "CC-BY-3.0", "observed", {"quality": 85}),
    "callisto-real.jpg": (CELESTIA + "hires/callisto.jpg", CELESTIA_PAGE + "hires/callisto.jpg",
        "ab97bf4917448b1f1574580dc07c3526ca582d5f95d71217518d590951c1ee7a", "Askaniy Anpilogov from John van Vliet; NASA/JPL Galileo and Voyager imagery", LEGACY, "observed", {"quality": 85}),
    "mimas-real.jpg": (CELESTIA + "hires/mimas.jpg", CELESTIA_PAGE + "hires/mimas.jpg",
        "efcefc4037f0acfd53a81c476c0da07523d386c09ef190929be4137b32e43b10", "Celestia, from Paul Schenk's enhanced-colour Cassini map (NASA/JPL/LPI Photojournal)", LEGACY, "observed", {"quality": 85}),
    "enceladus-real.jpg": (CELESTIA + "hires/enceladus.jpg", CELESTIA_PAGE + "hires/enceladus.jpg",
        "25f002668e20860917b0bf594d7fc32b516bdde96dfeaf30513ecea69826f26e", "Celestia, from Paul Schenk's enhanced-colour Cassini map (NASA/JPL/LPI Photojournal)", LEGACY, "observed", {"quality": 85}),
    "tethys-real.jpg": (CELESTIA + "hires/tethys.jpg", CELESTIA_PAGE + "hires/tethys.jpg",
        "9d2c3ee40571b47dc7b1868f137a313fa34f5b8c4b1b42f5aa0a8420c54987ad", "Celestia, from Paul Schenk's enhanced-colour Cassini map (NASA/JPL/LPI Photojournal)", LEGACY, "observed", {"quality": 85}),
    "dione-real.jpg": (CELESTIA + "hires/dione.jpg", CELESTIA_PAGE + "hires/dione.jpg",
        "5a9c05c403acd9af808aced83135a380c721a695af3ba46c58b88ef775a21b21", "Celestia, from Paul Schenk's enhanced-colour Cassini map (NASA/JPL/LPI Photojournal)", LEGACY, "observed", {"quality": 85}),
    "rhea-real.jpg": (CELESTIA + "hires/rhea.jpg", CELESTIA_PAGE + "hires/rhea.jpg",
        "f75ebe525954d7682de41af2228f48a138b1dcbe034cb0fbe8ccc456eeea8fdd", "Celestia, from Björn Jónsson's albedo map and NASA/JPL Cassini data (Paul Schenk)", LEGACY, "observed", {"quality": 85}),
    "titan-real.jpg": (CELESTIA + "hires/titan.png", CELESTIA_PAGE + "hires/titan.png",
        "fe440ed822243633369ebb9ee28d320e2ef63ac1a899dc98d76d5fffb1053225", "Askaniy Anpilogov, Pedro Garcia, AstroChara; NASA/JPL-Caltech/ASI/USGS; Caltech-JPL/Univ. of Arizona/LPG Nantes-CNRS", "CC-BY-3.0", "observed", {"quality": 85}),
    "hyperion-real.jpg": (CELESTIA + "medres/hyperion.jpg", CELESTIA_PAGE + "medres/hyperion.jpg",
        "b32fa8f4f98a1989f55ab3971d153adf2e3eb25d459969f550aefa310143c207", "ItzImcool", "CC-BY-4.0", "observed", {"quality": 85}),
    "iapetus-real.jpg": (CELESTIA + "hires/iapetus.jpg", CELESTIA_PAGE + "hires/iapetus.jpg",
        "d37c7fedc1747081bfbb84d2847c6e82f662a503e9fbdd75ac2faf66ede531b6", "Celestia, from Paul Schenk's enhanced-colour Cassini map (NASA/JPL/LPI Photojournal)", LEGACY, "observed", {"quality": 85}),
    "miranda-real.jpg": (CELESTIA + "hires/miranda.jpg", CELESTIA_PAGE + "hires/miranda.jpg",
        "c2da0d081edfaccee9e61511b7d96d0802233a0d24850116db8ea2ca2e3f94eb", "ItzImcool; Paul Schenk (2020); NASA/JPL/Ted Stryk", "CC-BY-SA-4.0", "observed", {"gray": True, "fill": True, "quality": 85}),
    "ariel-real.jpg": (CELESTIA + "hires/ariel.jpg", CELESTIA_PAGE + "hires/ariel.jpg",
        "17899b8198fb44907327c0f063cbabbd415a890914f1ff103bdffe8718cd7c9c", "ItzImcool; Paul Schenk (2020); NASA/JPL/Ted Stryk", "CC-BY-SA-4.0", "observed", {"gray": True, "fill": True, "quality": 85}),
    "umbriel-real.jpg": (CELESTIA + "medres/umbriel.jpg", CELESTIA_PAGE + "medres/umbriel.jpg",
        "916e0a355b10d90b8e8b04b473f89a8558386d6a23beea429e9958e05221e739", "ItzImcool; Paul Schenk (2020); Phil Stooke (2006); NASA/JPL/Ted Stryk", "CC-BY-SA-4.0", "observed", {"gray": True, "fill": True, "quality": 85}),
    "titania-real.jpg": (CELESTIA + "medres/titania.jpg", CELESTIA_PAGE + "medres/titania.jpg",
        "55aea8ea3666fffb1cd39d89c7b453f300e04e6c00f5aab0f11476bc1ab14301", "ItzImcool; Paul Schenk (2020); NASA/JPL/Ted Stryk", "CC-BY-SA-4.0", "observed", {"gray": True, "fill": True, "quality": 85}),
    "oberon-real.jpg": (CELESTIA + "medres/oberon.jpg", CELESTIA_PAGE + "medres/oberon.jpg",
        "7de46f0be23828a369cffaff32afc975eb0de3c35d5024252e735fe7e37db0c1", "ItzImcool; Paul Schenk (2020); NASA/JPL/Ted Stryk", "CC-BY-SA-4.0", "observed", {"gray": True, "fill": True, "quality": 85}),
    "triton-real.jpg": (CELESTIA + "hires/triton.jpg", CELESTIA_PAGE + "hires/triton.jpg",
        "0b1a0fbbd14a0f06fb4593f73abff9f3516397aef95895211b1926090854e4d8", "Askaniy Anpilogov; NASA/JPL-Caltech/ASI/USGS", "CC-BY-3.0", "observed", {"fill": True, "quality": 85}),
    "concept-asteroid.jpg": (CELESTIA + "hires/asteroid.jpg", CELESTIA_PAGE + "hires/asteroid.jpg",
        "1ba5304e697b95e8a9bd18270e050ac633aa79a07ba1da4a3e773e17ab690ae4", "cubicApocalypse (fictional asteroid texture)", "CC-BY-4.0", "concept", {}),
    "concept-haumea.jpg": (SSS_MIRROR + "4k_haumea_fictional.jpg", SSS_MIRROR_PAGE + "4k_haumea_fictional.jpg",
        "1e039b82323030cda110eb21e47e38f46a4e9c46dc24eb545428eb0263c28292", SSS + " (4k_haumea_fictional.jpg)", "CC-BY-4.0", "concept", {"quality": 85}),
    "star-g.jpg": (CELESTIA + "hires/gstar.jpg", CELESTIA_PAGE + "hires/gstar.jpg",
        "da4206ce67ace7edda7f9af120aef619d59ef353182e95f62a6999c52a1d2958", "MrSpace43; AstroChara; NASA/SDO and the AIA, EVE and HMI science teams", "CC-BY-SA-4.0", "concept", {"quality": 85}),
    "star-k.jpg": (CELESTIA + "hires/kstar.jpg", CELESTIA_PAGE + "hires/kstar.jpg",
        "5122baf64646207d8b5c4b1fe3cc0a463150cd01bfdaf24db4100d00227cc5cd", "MrSpace43; AstroChara; NASA/SDO and the AIA, EVE and HMI science teams", "CC-BY-SA-4.0", "concept", {"quality": 85}),
    "star-m.jpg": (CELESTIA + "hires/mstar.jpg", CELESTIA_PAGE + "hires/mstar.jpg",
        "ae4aa1b9eb0ae037e7933a2b13fed8fa92788e00eba2e849d2bed529f5619e7e", "Askaniy Anpilogov (2025)", "CC-BY-3.0", "concept", {"quality": 85}),
    "concept-makemake.jpg": (SSS_MIRROR + "4k_makemake_fictional.jpg", SSS_MIRROR_PAGE + "4k_makemake_fictional.jpg",
        "d94c950da2614aa643f88db24437d706c1e3975aa38f7943620141f14301625c", SSS + " (4k_makemake_fictional.jpg)", "CC-BY-4.0", "concept", {"quality": 85}),
    "concept-ceres.jpg": (SSS_MIRROR + "4k_ceres_fictional.jpg", SSS_MIRROR_PAGE + "4k_ceres_fictional.jpg",
        "e4452a4f84830a30d7a9b8be1b59c5a568e0aae8ed6ba5ebb7be0c3f672e7553", SSS + " (4k_ceres_fictional.jpg)", "CC-BY-4.0", "concept", {"quality": 85}),
    "concept-venuslike.jpg": (CELESTIA + "hires/venuslike.jpg", CELESTIA_PAGE + "hires/venuslike.jpg",
        "f59d2f69893843c5c6bb4fe594b0e9087f9a5bad1065f839f92ed4b16df8e474", "cubicApocalypse (fictional cloud-world texture)", "CC-BY-4.0", "concept", {"quality": 85}),
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, expected: str) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    cached = CACHE / expected
    if cached.exists() and sha256(cached.read_bytes()) == expected:
        return cached.read_bytes()
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()
    if sha256(data) != expected:
        raise SystemExit(f"Checksum mismatch for {url}")
    cached.write_bytes(data)
    return data


def box_mean(values: np.ndarray, radius: int) -> np.ndarray:
    """Box average that wraps in longitude and clamps at the poles."""
    size = 2 * radius + 1
    padded = np.pad(values.astype(np.float64), ((radius, radius), (0, 0)), mode="edge")
    padded = np.pad(padded, ((0, 0), (radius, radius)), mode="wrap")
    total = np.pad(padded.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    window = total[size:, size:] - total[:-size, size:] - total[size:, :-size] + total[:-size, :-size]
    return (window / (size * size)).astype(np.float32)


def fill_unimaged(pixels: np.ndarray) -> tuple[np.ndarray, float]:
    """Replace the flat grey placeholder of never-imaged terrain with a mirrored, longitude-shifted copy."""
    rgb = pixels if pixels.ndim == 3 else pixels[..., None]
    luminance = rgb.mean(axis=2)
    height, width = luminance.shape
    radius = max(4, width // 256)
    variance = box_mean(luminance * luminance, radius) - np.square(box_mean(luminance, radius))
    flat = variance < 0.5
    values, counts = np.unique(np.round(luminance[flat]), return_counts=True)
    placeholder = values[np.argmax(counts)] if len(values) else -1
    missing = Image.fromarray((flat & (np.abs(luminance - placeholder) < 3)).astype(np.uint8) * 255)
    # Opening keeps the large placeholder area and ignores smooth patches of real low-resolution imagery.
    missing = missing.filter(ImageFilter.MinFilter(2 * radius + 1)).filter(ImageFilter.MaxFilter(4 * radius + 1))
    missing = np.asarray(missing) > 127
    result = rgb.astype(np.float32)
    remaining = missing.copy()
    for shift, flip in ((width // 2, True), (width // 4, True), (width // 2, False), (3 * width // 4, True)):
        source = np.roll(rgb, shift, axis=1)
        source_missing = np.roll(missing, shift, axis=1)
        if flip:
            source, source_missing = source[::-1], source_missing[::-1]
        usable = remaining & ~source_missing
        result[usable] = source[usable]
        remaining &= ~usable
    feather = Image.fromarray((missing * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(max(3, width // 96)))
    alpha = np.asarray(feather, dtype=np.float32)[..., None] / 255.0
    blended = rgb * (1 - alpha) + result * alpha
    blended = np.clip(blended, 0, 255).astype(np.uint8)
    return (blended if pixels.ndim == 3 else blended[..., 0]), float(missing.mean())


def prepare(name: str, data: bytes, operation: dict) -> tuple[bytes, list[str], tuple[int, int]]:
    changes = []
    image = Image.open(io.BytesIO(data))
    if name in {"mars-real-8k.jpg", "moon-real-8k.jpg"}:
        assert image.size == (8192, 4096), f"{name} requires a native 8192x4096 source; no enlargement is permitted"
    if not operation:
        return data, ["unchanged"], image.size
    source_size, source_mode = image.size, image.mode
    image = image.convert("L" if operation.get("gray") else "RGB")
    if source_mode != image.mode:
        changes.append(f"{source_mode} converted to {image.mode}")
    width = operation.get("width")
    if width and image.width != width:
        image = image.resize((width, width // 2), Image.LANCZOS)
        changes.append(f"{source_size[0]}x{source_size[1]}, resized to {image.width}x{image.height}")
    if operation.get("fill"):
        pixels, fraction = fill_unimaged(np.asarray(image))
        image = Image.fromarray(pixels)
        changes.append(f"flat grey placeholder for never-imaged terrain ({fraction:.0%} of map) replaced by a mirrored, longitude-shifted copy of imaged terrain for illustration")
    quality = operation.get("quality", 85)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=quality, optimize=True, progressive=True, subsampling=0 if image.mode == "L" else 2)
    changes.append(f"encoded as JPEG quality {quality}")
    return buffer.getvalue(), changes, image.size


def main():
    selected = sys.argv[2:] or list(SOURCES)
    unknown = set(selected) - SOURCES.keys()
    if unknown:
        raise SystemExit(f"Unknown output file(s): {', '.join(sorted(unknown))}")
    manifest_path = OUTPUT / "provenance.json"
    manifest = json.loads(manifest_path.read_text())
    for name in dict.fromkeys(selected):
        url, page, expected, credit, license_name, kind, operation = SOURCES[name]
        data = fetch(url, expected)
        output, changes, size = prepare(name, data, operation)
        (OUTPUT / name).write_bytes(output)
        manifest[name] = {"source": page, "credit": credit, "license": license_name, "kind": kind,
            "changes": "; ".join(changes), "width": size[0], "height": size[1],
            "sourceSha256": expected, "sha256": sha256(output)}
        print(f"{name}: {size[0]}x{size[1]}, {len(output) / 1e6:.2f} MB, {kind}")
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
