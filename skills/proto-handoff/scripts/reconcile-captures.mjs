// scan.json → newest frame per screen into <capture>/nodes.json (screens of the given jobs file
// only) and the other frames as duplicates to delete.
//   node reconcile-captures.mjs <scan.json> <jobs.json> <nodes.json>   (scan: find-captures.js result)
// The scan is what figma/find-captures.js returns ({ captures: { screen: id }, duplicates:
// { screen: [ids] } }) or a plain { screen: [frameIds] }.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [scanF, jobsF, out] = process.argv.slice(2);
if (!out) { console.error('usage: reconcile-captures.mjs <scan.json> <jobs.json> <nodes.json>'); process.exit(1); }
const raw = JSON.parse(readFileSync(scanF, 'utf8'));
const scan = {};
if (raw && typeof raw.captures === 'object') {
  for (const [s, id] of Object.entries(raw.captures)) (scan[s] = scan[s] || []).push(id);
  for (const [s, ids] of Object.entries(raw.duplicates || {})) (scan[s] = scan[s] || []).push(...ids);
} else {
  for (const [s, ids] of Object.entries(raw || {})) scan[s] = Array.isArray(ids) ? ids : [ids];
}
const jobs = JSON.parse(readFileSync(jobsF, 'utf8')).map((j) => j.screen);
const num = (id) => id.split(':').map(Number);
const newer = (a, b) => { const [x1, y1] = num(a), [x2, y2] = num(b); return x1 !== x2 ? x1 - x2 : y1 - y2; };
const nodes = {}, dup = [];
for (const s of jobs) {
  const ids = [...new Set(scan[s] || [])].sort(newer);
  if (!ids.length) continue;
  nodes[s] = ids[ids.length - 1];
  dup.push(...ids.slice(0, -1));
}
const missing = jobs.map((s, i) => (nodes[s] ? null : i + 1)).filter(Boolean);
// a scan that matches nothing (wrong page, wrong shape) must not wipe a table that has captures
if (!Object.keys(nodes).length && existsSync(out)) {
  let had = {};
  try { had = JSON.parse(readFileSync(out, 'utf8')); } catch { /* unreadable: overwrite */ }
  if (Object.keys(had).length) {
    console.error(`The scan matched none of the ${jobs.length} screens; ${out} was left as it was. Check that find-captures ran on the page where the captures landed.`);
    process.exit(1);
  }
}
writeFileSync(out, JSON.stringify(nodes, null, 1));
console.log(JSON.stringify({ have: Object.keys(nodes).length, of: jobs.length, missing, dup }));
