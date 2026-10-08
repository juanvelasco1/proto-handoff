#!/usr/bin/env node
// Rebuilds the sync baseline from a migrated HTML when the work dir lost it: bands.json (the flow
// recipes migrate.mjs reads) and orig.html (the source with the injected scripts stripped, checked
// against the sha256 its ui-manifest recorded).  node rebuild-base.mjs <migrated.html> <out-dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [html, outDir] = process.argv.slice(2);
const src = readFileSync(html, 'utf8');
const unesc = (s) => s.replace(/<\\\/script/gi, '</script');
const man = JSON.parse(unesc(src.match(/<script type="application\/json" id="ui-manifest">([\s\S]*?)<\/script>/)[1]));
const ad = JSON.parse(unesc(src.match(/<script id="ui-adapter">window.__UI_ADAPTER__=([\s\S]*?);<\/script>/)[1]));
const bands = man.flows.map((f) => ({ k: f.key, t: f.title, n: f.note, kind: f.kind,
  cells: f.steps.map((st) => { const s = ad.screens[st.screen]; return { id: st.cell, t: s.title, s: s.subtitle, steps: s.recipe, via: st.via }; }) }));
writeFileSync(`${outDir}/bands.json`, JSON.stringify(bands, null, 1));
const orig = src.replace(/\n<script id="ui-adapter">[\s\S]*?<\/script>\n<script id="ui-runtime-boot">[\s\S]*?<\/script>\n/, '')
  .replace(/<script id="ui-runtime">[\s\S]*?<\/script>\n<script type="application\/json" id="ui-manifest">[\s\S]*?<\/script>\n(?=<\/body>)/, '');
const sha = createHash('sha256').update(orig).digest('hex');
writeFileSync(`${outDir}/orig.html`, orig);
console.log(JSON.stringify({ flows: bands.length, cells: bands.reduce((a, b) => a + b.cells.length, 0), screens: Object.keys(ad.screens).length, origSha: sha.slice(0, 12), wanted: man.source.sha256.slice(0, 12) }));
