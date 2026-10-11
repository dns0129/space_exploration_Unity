#!/usr/bin/env python3
"""Subset the pinned Noto CJK font for Voyager's Chinese UI (requires fonttools)."""
import argparse
import json
from pathlib import Path
from fontTools import subset

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path, help='NotoSansCJKsc-Regular.otf from the source pinned in docs/fonts/README.md')
args = parser.parse_args()
text = ''.join(chr(value) for value in range(32, 127))
text += ''.join(path.read_text() for path in (root / 'Assets/Voyager').rglob('*.cs'))
text += json.dumps(json.loads((root / 'Assets/StreamingAssets/Voyager/world.json').read_text()), ensure_ascii=False)
options = subset.Options()
options.name_IDs = ['*']
options.name_legacy = True
options.name_languages = ['*']
font = subset.load_font(str(args.source), options)
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
for entry in font['name'].names:
    if entry.nameID in (1, 3, 4, 6):
        entry.string = ('VoyagerUISubset' if entry.nameID == 6 else 'Voyager UI Subset').encode(entry.getEncoding())
if 'CFF ' in font:
    font['CFF '].cff.fontNames = ['VoyagerUISubset']
    for dictionary in font['CFF '].cff.topDictIndex:
        dictionary.FullName = 'Voyager UI Subset'
        dictionary.FamilyName = 'Voyager UI Subset'
output = root / 'Assets/Resources/VoyagerUI.otf'
subset.save_font(font, str(output), options)
print(f'Generated {output.name}: {output.stat().st_size} bytes, {len(set(text))} requested characters.')
