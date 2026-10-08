#!/usr/bin/env node
// Prints one self-contained use_figma script: a template from figma/ with its PARAMS filled in.
// For the one-off helpers the build does not generate, such as the read-only capture scan and
// the text census:
//
//   node template.mjs find-captures '{"page":"<screens page id>"}'   > gen/find-captures.js
//   node template.mjs census-type   '{"page":"<screens page id>"}'   > gen/census-type.js
//
// Without params it prints the template's defaults, so you can see which keys it takes.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fill } from './lib/fill.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [name, raw] = process.argv.slice(2);
const names = readdirSync(path.join(here, 'figma')).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
if (!name || !names.includes(name.replace(/\.js$/, ''))) {
  console.error(`usage: template.mjs <template> '<params json>'\ntemplates: ${names.join(', ')}`);
  process.exit(1);
}
const file = name.replace(/\.js$/, '') + '.js';
const defaults = readFileSync(path.join(here, 'figma', file), 'utf8').match(/const PARAMS = \/\*PARAMS\*\/([\s\S]*?)\/\*END\*\//);
if (!defaults) { console.error(`${file} takes no PARAMS: run it as it is.`); process.exit(1); }
if (!raw) { console.log(`${file} PARAMS (defaults):${defaults[1]}`); process.exit(0); }
let params;
try { params = JSON.parse(raw); } catch (e) { console.error(`The params are not valid JSON: ${e.message}`); process.exit(1); }
if (!params || typeof params !== 'object' || Array.isArray(params)) { console.error('The params must be a JSON object.'); process.exit(1); }
// keys left out keep the template's defaults (the literal comes from our own template file)
const base = new Function(`return (${defaults[1]});`)();
process.stdout.write(fill(file, { ...base, ...params }));
