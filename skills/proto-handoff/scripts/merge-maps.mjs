// One map dir from a chunked capture: every batch's screen maps (same page load as the capture),
// their links merged (each batch resolved the links of the screens it opened) and the manifest.
//   node merge-maps.mjs <work-dir>/capture <work-dir>/next/<maps>
import { readFileSync, writeFileSync, readdirSync, mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
const [cap, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const links = [], seen = new Set();
let maps = 0, manifest = null;
// a screen captured twice (a retry, a recapture with a newer runtime) keeps its newest map; the
// batch dirs are visited newest first so the newest links win the dedup too
const dirs = readdirSync(cap).filter((x) => /^b\d+$/.test(x)).sort((a, b) => statSync(path.join(cap, b)).mtimeMs - statSync(path.join(cap, a)).mtimeMs);
// the map of the attempt whose capture was recorded (records.log cid → the batch that sent it):
// a later attempt that never landed may come from another runtime (a timeline scrolled back to 0)
const sentIn = {};
for (const d of dirs) {
  const sp = path.join(cap, d, 'sent.json');
  if (existsSync(sp)) for (const s of JSON.parse(readFileSync(sp, 'utf8'))) if (s.captureId && !sentIn[s.captureId]) sentIn[s.captureId] = d;
}
const recordedIn = {};
const logp = path.join(cap, 'records.log');
if (existsSync(logp)) for (const l of readFileSync(logp, 'utf8').trim().split('\n')) { const r = JSON.parse(l); recordedIn[r.screen] = sentIn[r.cid] || null; }
const newest = {};
for (const d of dirs) {
  const dir = path.join(cap, d);
  for (const f of readdirSync(dir).filter((x) => /^\d+-.*\.json$/.test(x))) {
    const p = path.join(dir, f), m = statSync(p).mtimeMs;
    const screen = JSON.parse(readFileSync(p, 'utf8')).screen;
    const want = recordedIn[screen];
    const rank = want ? (d === want ? 2 : 0) : 1;
    if (!newest[f] || rank > newest[f].rank || (rank === newest[f].rank && m > newest[f].m)) newest[f] = { p, m, rank };
  }
  if (existsSync(path.join(dir, 'links.json'))) {
    for (const l of JSON.parse(readFileSync(path.join(dir, 'links.json'), 'utf8'))) {
      const k = [l.from, l.to, l.stmt].join('|');
      if (!seen.has(k)) { seen.add(k); links.push(l); }
    }
  }
  if (!manifest && existsSync(path.join(dir, 'manifest.json'))) manifest = path.join(dir, 'manifest.json');
}
for (const [f, { p }] of Object.entries(newest)) { copyFileSync(p, path.join(out, f)); maps++; }
writeFileSync(path.join(out, 'links.json'), JSON.stringify(links, null, 1));
if (manifest) copyFileSync(manifest, path.join(out, 'manifest.json'));
console.log(JSON.stringify({ maps, links: links.length, manifest: !!manifest }));
