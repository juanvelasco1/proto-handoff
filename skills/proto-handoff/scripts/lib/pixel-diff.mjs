// Share of pixels that differ between two PNG screenshots of the same screen — the "pixels" signal
// of sync.mjs detect. A pixel differs when any of its R, G, B channels moves by more than 8/255;
// alpha is ignored. Screenshots of different sizes count as fully different (1).
//
//   import { pixelShare } from './lib/pixel-diff.mjs'; pixelShare(a.png, b.png) → 0…1
//   node lib/pixel-diff.mjs <a.png> <b.png>                                     → prints the share
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const THRESHOLD = 8;

export function pixelShare(fileA, fileB) {
  const a = PNG.sync.read(readFileSync(fileA));
  const b = PNG.sync.read(readFileSync(fileB));
  if (a.width !== b.width || a.height !== b.height) return 1;
  const total = a.width * a.height;
  let diff = 0;
  // RGBA, 8 bits per channel (pngjs expands palette and gray images and rescales 16-bit ones)
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > THRESHOLD || Math.abs(a.data[i + 1] - b.data[i + 1]) > THRESHOLD
      || Math.abs(a.data[i + 2] - b.data[i + 2]) > THRESHOLD) diff++;
  }
  return diff / total;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [x, y] = process.argv.slice(2);
  if (!x || !y) { console.error('usage: node lib/pixel-diff.mjs <a.png> <b.png>'); process.exit(2); }
  console.log(pixelShare(x, y));
}
