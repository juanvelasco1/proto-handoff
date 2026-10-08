#!/usr/bin/env node
// Re-embeds the current contract runtime (runtime/contract-runtime.js) into a prototype copy that
// migrate.mjs already migrated. The served copy carries the runtime inline, twice (the
// `ui-runtime-boot` block in <head> and the `ui-runtime` block before </body>): after changing
// runtime/contract-runtime.js, every served copy must be re-embedded, or the captures keep the
// old tags.
//
//   node embed-runtime.mjs <migrated.html> [--out <file>]     (in place unless --out)
//
// Verifies the result: both blocks hold exactly the current runtime, and its marker
// (window.__UI_CONTRACT__) is in the file. Exits 1 when something does not match.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const file = args[0];
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : file;
if (!file || !out) { console.error('usage: node embed-runtime.mjs <migrated.html> [--out <file>]'); process.exit(2); }

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = readFileSync(path.join(here, 'runtime/contract-runtime.js'), 'utf8');
// the same escaping migrate.mjs uses, so a </script inside the runtime cannot close the block
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const body = esc(runtime);
const MARKER = 'window.__UI_CONTRACT__';
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

const html = readFileSync(file, 'utf8');
const blocks = { 'ui-runtime-boot': 0, 'ui-runtime': 0 };
const next = html.replace(/<script id="(ui-runtime-boot|ui-runtime)">[\s\S]*?<\/script>/g, (m, id) => {
  blocks[id]++;
  return `<script id="${id}">${body}</script>`;
});
const missing = Object.entries(blocks).filter(([, n]) => n !== 1).map(([id, n]) => `${id} ×${n}`);
if (missing.length) {
  console.error(`not a migrated copy (expected one of each runtime block): ${missing.join(', ')}. Run migrate.mjs on the original instead.`);
  process.exit(1);
}
writeFileSync(out, next);

// verify what was written
const check = readFileSync(out, 'utf8');
const got = [...check.matchAll(/<script id="(ui-runtime-boot|ui-runtime)">([\s\S]*?)<\/script>/g)].map(([, id, b]) => ({ id, ok: b === body }));
const ok = got.length === 2 && got.every((g) => g.ok) && check.includes(MARKER);
console.log(JSON.stringify({ out, runtime: sha(runtime), changed: next !== html, blocks: got, marker: check.includes(MARKER), ok }));
process.exit(ok ? 0 : 1);
