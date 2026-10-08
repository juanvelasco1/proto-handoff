#!/usr/bin/env python3
"""OPTIONAL helper (Python 3 + Pillow + numpy; nothing else in the skill needs Python).

Pixel comparison between the prototype and its Figma rebuild, screen by screen.

    python3 audit-visual.py <pairs.json> [--out audit/]

pairs.json: [{"screen": "...", "browser": "path.png", "figma": "path.png"}, ...]
The Figma render is usually downscaled (get_screenshot caps at 1024 px), so the browser
shot is resized to the Figma render's size before comparing.

Per screen it reports the share of pixels that differ noticeably (any channel > 24/255) and
writes a diff image that paints those pixels red over a faded copy of the prototype, so a
reviewer can see WHERE they differ, not only how much.

Install its dependencies only if you want this report: python3 -m pip install pillow numpy
"""
import json, os, sys
from PIL import Image, ImageChops
import numpy as np

args = sys.argv[1:]
pairs = json.load(open(args[0]))
out = args[args.index('--out') + 1] if '--out' in args else 'audit'
os.makedirs(out, exist_ok=True)

THRESH = 24
rows = []
for p in pairs:
    fig = Image.open(p['figma']).convert('RGB')
    web = Image.open(p['browser']).convert('RGB').resize(fig.size, Image.LANCZOS)
    a = np.asarray(web).astype(int)
    b = np.asarray(fig).astype(int)
    mask = (np.abs(a - b).max(axis=2) > THRESH)
    share = float(mask.mean())
    faded = (a * 0.35 + 255 * 0.65).astype(np.uint8)
    faded[mask] = [220, 30, 30]
    name = p['screen'].replace('/', '_')
    Image.fromarray(faded).save(os.path.join(out, f'diff_{name}.png'))
    rows.append({'screen': p['screen'], 'differentPixels': round(share * 100, 2)})

for r in rows:
    flag = 'OK ' if r['differentPixels'] < 1.5 else ('LOOK' if r['differentPixels'] < 5 else 'BAD')
    print(f"{flag}  {r['differentPixels']:6.2f}%  {r['screen']}")
json.dump(rows, open(os.path.join(out, 'visual.json'), 'w'), indent=1)
