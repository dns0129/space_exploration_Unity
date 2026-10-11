"""Retrieve the licensed native 8K Milky Way panorama; never upscale.

Only normal HTTPS to the pinned GitHub mirror is used. The existing 4K
fallback is intentionally preserved for compact GPUs and archived packages.
"""
from pathlib import Path
import hashlib
import json
import urllib.request
from PIL import Image
from io import BytesIO

ROOT = Path(__file__).resolve().parent.parent
REVISION = '235e72c02e825e0c8d0792ec0aa6be43e1a14f68'
PATH = 'textures/8k_stars_milky_way.jpg'
SOURCE = f'https://raw.githubusercontent.com/Whitebee7/solarsystem/{REVISION}/{PATH}'
EXPECTED = '1fd005ddd6d53364cc5106e0121b83fd3bca236b1503f6b51f5501d9d51eafaf'

with urllib.request.urlopen(SOURCE, timeout=60) as response:
    data = response.read()
checksum = hashlib.sha256(data).hexdigest()
if checksum != EXPECTED:
    raise RuntimeError(f'Unexpected source checksum: {checksum}')
if Image.open(BytesIO(data)).size != (8192, 4096):
    raise RuntimeError('Milky Way source is not native 8192 × 4096')
output = ROOT / 'public/textures/milky-way-8k.jpg'
output.write_bytes(data)

manifest = ROOT / 'public/textures/provenance.json'
provenance = json.loads(manifest.read_text())
provenance[output.name] = {
    'source': f'https://github.com/Whitebee7/solarsystem/blob/{REVISION}/{PATH}',
    'credit': 'Solar System Scope',
    'license': 'CC-BY-4.0',
    'kind': 'astronomical panorama artwork',
    'changes': 'Native 8192x4096 source, unchanged and not upscaled; directly sampled without conversion to a lower-resolution cubemap. Photographic exposure adjustment and original analytic star points are applied only during rendering.',
    'width': 8192,
    'height': 4096,
    'sourceSha256': checksum,
    'sha256': checksum,
}
manifest.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
print(f'Prepared {output.name}: 8192 × 4096, {len(data):,} bytes, native source verified')
