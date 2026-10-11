"""Original, seamless equirectangular sky artwork; not an observed sky survey.

Development-only asset generator: Python, NumPy and Pillow.
The game loads the saved JPEG and needs no Python dependencies.
"""
from pathlib import Path
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
WIDTH, HEIGHT = 4096, 2048
rng = np.random.default_rng(20261003)
longitude = np.linspace(-np.pi, np.pi, WIDTH, endpoint=False, dtype=np.float32)[None, :]
latitude = np.linspace(np.pi / 2, -np.pi / 2, HEIGHT, dtype=np.float32)[:, None]
x, y, z = np.cos(latitude) * np.cos(longitude), np.sin(latitude), np.cos(latitude) * np.sin(longitude)

def cloud(frequency, seed):
    value = np.zeros((HEIGHT, WIDTH), dtype=np.float32)
    for octave in range(5):
        f = frequency * 2 ** octave
        value += (np.sin(x*f + z*f*.73 + seed) * np.cos(y*f*1.17 - z*f*.41 + seed*.33)
                  + np.sin(z*f*.87 - y*f*.57 + seed*1.71)) * (0.5 ** octave)
    return value / 3.875 + 0.5

plane = x*.47 + y*.76 + z*.447
texture = cloud(8.2, 3.1)
fine = cloud(32, 8.7)
belt = np.exp(-np.square(plane) * 26)
wisps = belt * np.maximum(0, texture - .26) ** 1.5
dust = np.exp(-np.square(plane + (texture - .5)*.19) * 1100) * (0.3 + fine*.7)
blue = np.maximum(0, cloud(3.5, 11.8) - .42) * belt
rgb = np.zeros((HEIGHT, WIDTH, 3), dtype=np.float32)
for channel, base in enumerate([3, 5, 12]):
    rgb[:, :, channel] = base + wisps * [88, 115, 177][channel] + blue * [47, 14, 89][channel]
    rgb[:, :, channel] *= 1 - dust*.78

image = Image.fromarray(np.uint8(np.clip(rgb, 0, 255)))
stars = Image.new('RGB', (WIDTH, HEIGHT))
draw = ImageDraw.Draw(stars)
for index in range(22000):
    u, v = rng.random(), rng.random()
    px = int(u * WIDTH)
    py = int(np.arccos(2*v - 1) / np.pi * (HEIGHT - 1))
    brightness = int(rng.uniform(45, 205))
    tint = rng.choice([(1, .93, .8), (.8, .9, 1), (1, .83, .72)])
    color = tuple(int(brightness*c) for c in tint)
    radius = 1 if index % 45 == 0 else 0
    draw.ellipse((px-radius, py-radius, px+radius, py+radius), fill=color)
    if index % 2200 == 0 and 20 < px < WIDTH-20 and 20 < py < HEIGHT-20:
        draw.line((px-5, py, px+5, py), fill=tuple(int(c*.65) for c in color))
        draw.line((px, py-5, px, py+5), fill=tuple(int(c*.65) for c in color))

glow = stars.filter(ImageFilter.GaussianBlur(2.5))
result = np.array(image, dtype=np.float32) + np.array(stars) + np.array(glow)*.8
path = ROOT / 'public/textures/centauri-milky-way-4k.jpg'
Image.fromarray(np.uint8(np.clip(result, 0, 255))).save(path, quality=92)
provenance = ROOT / 'public/textures/provenance.json'
data = json.loads(provenance.read_text())
data[path.name] = {
    'source': 'scripts/generate-centauri-sky.py',
    'credit': 'Original procedural sky artwork for VOYAGER',
    'license': 'Project original artwork',
    'changes': 'New seeded spherical blue-violet dust-band panorama; not a retexture of the Solar System sky or a scientific survey',
    'width': WIDTH, 'height': HEIGHT,
    'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
}
provenance.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print(f'Generated {path.name}: {WIDTH}x{HEIGHT}, {path.stat().st_size} bytes')
