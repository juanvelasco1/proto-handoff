#!/usr/bin/env node
// Records a completed capture: the node id comes from the "node-id=AAA-BBB" link that
// generate_figma_design returns once the capture is in.
//
//   node capture-record.mjs <work-dir> <captureId> <AAA-BBB>
//
// Several capture agents may run at once: each record is one appended line of
// capture/records.log and capture/nodes.json is rebuilt from the whole log (latest per screen). When the log and the
// file disagree (a capture finished after it was given up, a retry left two frames), the Figma
// scan wins: figma/find-captures.js.
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';

const [work, cid, node] = process.argv.slice(2);
const dir = path.join(work, 'capture');
let screen = null;
for (const d of readdirSync(dir)) {
  const p = path.join(dir, d, 'sent.json');
  if (!existsSync(p)) continue;
  const hit = JSON.parse(readFileSync(p, 'utf8')).find((s) => s.captureId === cid);
  if (hit) screen = hit.screen;
}
if (!screen) throw new Error('unknown capture id ' + cid);
const log = path.join(dir, 'records.log');
appendFileSync(log, JSON.stringify({ screen, node: node.replace('-', ':'), cid }) + '\n');
const all = {};
// the latest record of a screen wins: a recapture (a new runtime, a fix) replaces the frame it had
for (const l of readFileSync(log, 'utf8').trim().split('\n')) { const r = JSON.parse(l); all[r.screen] = r.node; }
writeFileSync(path.join(dir, 'nodes.json'), JSON.stringify(all, null, 1));
console.log(JSON.stringify({ screen, node: all[screen], recorded: Object.keys(all).length }));
