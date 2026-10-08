// scan.json { screen: [frameIds] } → newest frame per screen into <capture>/nodes.json (screens of
// the given jobs file only) and the other frames as duplicates to delete.
//   node reconcile-captures.mjs <scan.json> <jobs.json> <nodes.json>   (scan: find-captures.js result)
import { readFileSync, writeFileSync } from 'node:fs';
const [scanF, jobsF, out] = process.argv.slice(2);
const scan = JSON.parse(readFileSync(scanF, 'utf8'));
const jobs = JSON.parse(readFileSync(jobsF, 'utf8')).map((j) => j.screen);
const num = (id) => id.split(':').map(Number);
const newer = (a, b) => { const [x1, y1] = num(a), [x2, y2] = num(b); return x1 !== x2 ? x1 - x2 : y1 - y2; };
const nodes = {}, dup = [];
for (const s of jobs) {
  const ids = (scan[s] || []).slice().sort(newer);
  if (!ids.length) continue;
  nodes[s] = ids[ids.length - 1];
  dup.push(...ids.slice(0, -1));
}
writeFileSync(out, JSON.stringify(nodes, null, 1));
console.log(JSON.stringify({ have: Object.keys(nodes).length, of: jobs.length, missing: jobs.map((s, i) => nodes[s] ? null : i + 1).filter(Boolean), dup }));
