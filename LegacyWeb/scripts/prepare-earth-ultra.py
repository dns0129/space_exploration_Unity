"""Prepare NASA/GEBCO Earth maps and bordered native-16K tiles.

Usage: python scripts/prepare-earth-ultra.py /path/to/downloaded/sources
Sources and the pinned mirror revision are documented in ASSETS.md.
No upscaling or invented geographical detail is applied.
"""
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
src = Path(sys.argv[1])
out = Path(__file__).resolve().parent.parent / 'public/textures'
revision = 'c92393f8be6b94f3684399f18e55790c91a8fdb4'
root = f'https://github.com/simon23-12/orbital-botany/blob/{revision}/assets/earth/'
manifest = json.loads((out / 'provenance.json').read_text())


def save(image, filename, source, changes):
    path = out / filename
    options = dict(quality=93, subsampling=0, optimize=True) if filename.endswith('.jpg') else dict(optimize=True)
    image.save(path, **options)
    manifest[filename] = {
        'source': root + source,
        'credit': 'NASA Earth Observatory / MODIS' if source.startswith(('day', 'cloud')) else
                  'NASA / VIIRS Black Marble 2016' if source.startswith('night') else 'GEBCO 08 / NASA Visible Earth',
        'license': 'NASA public-domain imagery; GEBCO freely usable data',
        'kind': 'observed', 'changes': changes,
        'width': image.width, 'height': image.height,
        'sourceSha256': hashlib.sha256((src / source).read_bytes()).hexdigest(),
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    }


day = Image.open(src / 'day_09_16k.jpg').convert('RGB')
assert day.size == (16384, 8192), 'The day source must be native 16K.'
for width, name in [(4096, 'earth-day.jpg'), (8192, 'earth-day-8k.jpg')]:
    save(day.resize((width, width // 2), Image.Resampling.LANCZOS), name,
         'day_09_16k.jpg', 'September 2004 mosaic without baked relief; Lanczos downsample; JPEG quality 93, 4:4:4')

# Eight columns by four rows, 2048-square interiors with an eight-pixel gutter.
# Longitude gutters wrap; latitude gutters repeat the pole, preserving mip filtering.
pad, size = 8, 2048
for row in range(4):
    for col in range(8):
        x, y = col * size, row * size
        tile = Image.new('RGB', (size + 2 * pad, size + 2 * pad))
        for ty in range(tile.height):
            sy = min(max(y + ty - pad, 0), day.height - 1)
            strip = day.crop((max(0, x - pad), sy, min(day.width, x + size + pad), sy + 1))
            tx = pad if col == 0 else 0
            tile.paste(strip, (tx, ty))
            if col == 0:
                tile.paste(day.crop((day.width - pad, sy, day.width, sy + 1)), (0, ty))
            if col == 7:
                tile.paste(day.crop((0, sy, pad, sy + 1)), (size + pad, ty))
        save(tile, f'earth-detail-{col}-{row}.jpg', 'day_09_16k.jpg',
             f'Native 16K crop, column {col}/8, north-to-south row {row}/4; 2048x2048 interior with 8px wrapped/clamped gutter; JPEG quality 93, 4:4:4')

for source, stem in [('clouds_8k.jpg', 'clouds'), ('night_8k.jpg', 'night'), ('terrain_8k.png', 'terrain')]:
    image = Image.open(src / source).convert('L')
    assert image.size == (8192, 4096)
    ext = 'png' if stem == 'terrain' else 'jpg'
    for width in (4096, 8192):
        name = 'earth-night.jpg' if stem == 'night' and width == 4096 else f'earth-{stem}-{width // 1024}k.{ext}'
        result = image if width == 8192 else image.resize((width, width // 2), Image.Resampling.LANCZOS)
        save(result, name, source, 'Single-channel density / night radiance / water=0, land=40+GEBCO elevation; native 8K or Lanczos 4K fallback')

(out / 'provenance.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print('Prepared native 16K Earth tiles and 8K/4K supporting maps.')
