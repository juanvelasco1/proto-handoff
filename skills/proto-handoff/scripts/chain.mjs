#!/usr/bin/env node
// Chains generated run scripts (each one "run one installed template with these PARAMS") so one
// use_figma call runs several steps in order and stops at the first error. Keep every chain well
// under the 50 000-character limit of use_figma: steps that carry per-frame data (verify, wire,
// validate) go one per call.
//
//   node chain.mjs <out-dir> '<[["name", ["gen/L0-build.js", "gen/L0-swap-a.js"]], …]>'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { chain } from './lib/fill.mjs';

const [outDir, groupsJson] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const parse = (file) => {
  const s = readFileSync(file, 'utf8');
  const T = s.match(/const T = "([^"]+)"/)[1];
  const i = s.indexOf('(figma, ') + 8;
  return [T + '.js', s.slice(i, s.lastIndexOf(');'))];
};
const out = [];
for (const [name, files] of JSON.parse(groupsJson)) {
  const code = chain(files.map(parse))
    // compact results: per component occurrences→variants or swapped(+added)(FAIL…)
    .replace('steps.push({ T: s.T, r });', 'const compact = {}; for (const [k, v] of Object.entries(r || {})) compact[k] = v && typeof v === "object" ? (v.variants !== undefined ? v.occurrences + "→" + v.variants + (v.slot ? "/" + v.slot : "") : v.swapped !== undefined ? v.swapped + (v.added ? "+" + v.added : "") + (v.failed ? " FAIL" + v.failed + " " + (v.error || "") : "") : JSON.stringify(v).slice(0, 120)) : v; steps.push({ T: s.T, r: compact });');
  if (code.length > 45000) throw new Error(`${name}: ${code.length} characters — split it (use_figma takes at most 50 000)`);
  writeFileSync(`${outDir}/${name}.js`, code);
  out.push(`${name}: ${files.length} steps, ${code.length} B`);
}
console.log(out.join('\n'));
