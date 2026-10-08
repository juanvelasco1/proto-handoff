#!/usr/bin/env node
// Brings a legacy prototype up to the handoff-ready contract without rewriting it:
// injects the contract runtime, a declarative adapter (components, sections, nav types)
// and a route table built from flow recipes, plus the ui-manifest.
//
//   node migrate.mjs <in.html> <adapter.json> <flows.json> <out.html>
//
// flows.json: [{ k, t, n, kind, cells: [{ id, t, s, steps, via }] }] — the shape of a screenshot
// flow map's bands, so an existing flow map becomes the route table as is.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [inFile, adapterFile, flowsFile, outFile] = process.argv.slice(2);
if (!outFile) { console.error('usage: migrate.mjs <in.html> <adapter.json> <flows.json> <out.html>'); process.exit(1); }

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = readFileSync(path.join(here, 'runtime/contract-runtime.js'), 'utf8');
const html = readFileSync(inFile, 'utf8');
const adapter = JSON.parse(readFileSync(adapterFile, 'utf8'));
const bands = JSON.parse(readFileSync(flowsFile, 'utf8'));

// words left out of the screen-id slugs (Spanish articles and prepositions: titles in other
// languages keep every word). Changing this list changes the ids of existing screens.
const STOP = new Set(['la', 'el', 'los', 'las', 'de', 'del', 'y', 'a', 'un', 'una', 'al', 'en']);
const slug = (s, max = 4) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
  .filter((w) => w && !STOP.has(w)).slice(0, max).join('-') || 'x';

const screens = {};
const byRecipe = {};
const flows = [];
const usedIds = new Set();
for (const b of bands) {
  const flowId = slug(b.t, 3);
  const ids = [];
  for (const c of b.cells) {
    const recipe = (c.steps || '').trim();
    let id = byRecipe[recipe];
    if (!id) {
      id = `${flowId}/${slug(c.t)}`;
      let n = 2; while (usedIds.has(id)) id = `${flowId}/${slug(c.t)}-${n++}`;
      usedIds.add(id);
      byRecipe[recipe] = id;
      screens[id] = { title: c.t, subtitle: c.s, recipe, source: c.id };
    }
    ids.push({ screen: id, via: c.via || null, cell: c.id });
  }
  flows.push({ id: flowId, key: b.k, title: b.t, note: b.n, kind: b.kind || 'row', start: ids[0].screen, steps: ids });
}

// Icon dictionaries: prototypes keep their glyphs as `name:'<path …/>'` entries. Keyed by the
// normalized markup, so the runtime can name every rendered <svg> (see iconKey in the runtime).
const iconKey = (m) => m.replace(/\s+/g, '').replace(/<\/\w+>/g, '').replace(/\/>/g, '>');
const icons = {};
// Any `var|let|const NAME = { … }` literal whose values are mostly SVG child markup is an icon
// dictionary. The literal is evaluated on its own (strings and concatenations only), so values
// split over several lines with + still resolve.
const SVGISH = /^\s*<(path|circle|rect|line|polyline|polygon|ellipse|g)\b/;
for (const m of html.matchAll(/(?:var|let|const)\s+[A-Za-z_$][\w$]*\s*=\s*\{/g)) {
  let depth = 0, i = m.index + m[0].length - 1, end = -1, quote = null;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
    if (ch === '/' && html[i + 1] === '*') { i = html.indexOf('*/', i + 2) + 1; if (i === 0) break; continue; }
    if (ch === '/' && html[i + 1] === '/') { i = html.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0 || end - m.index > 400000) continue;
  let dict;
  try { dict = Function(`"use strict"; return (${html.slice(m.index + m[0].length - 1, end + 1)});`)(); } catch (e) { continue; }
  const entries = Object.entries(dict || {}).filter(([, v]) => typeof v === 'string');
  if (entries.length < 3 || entries.filter(([, v]) => SVGISH.test(v)).length < entries.length * 0.8) continue;
  for (const [name, markup] of entries) if (SVGISH.test(markup) && !icons[iconKey(markup)]) icons[iconKey(markup)] = name;
}
// …and glyphs added later one by one: `S.cube = '<path …/>' + '…';`
for (const m of html.matchAll(/\b[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)\s*=\s*('(?:[^'\\]|\\.)*'(?:\s*\+\s*'(?:[^'\\]|\\.)*')*)\s*;/g)) {
  let v; try { v = Function(`"use strict"; return (${m[2]});`)(); } catch (e) { continue; }
  if (typeof v === 'string' && SVGISH.test(v) && !icons[iconKey(v)]) icons[iconKey(v)] = m[1];
}
const runtimeAdapter = { ...adapter, screens, icons };
const manifest = {
  contract: adapter.contract, name: adapter.name, summary: adapter.summary,
  platform: adapter.platform, device: adapter.device, themes: adapter.themes,
  source: { file: path.basename(inFile), sha256: createHash('sha256').update(html).digest('hex') },
  flows,
  screens: Object.fromEntries(Object.entries(screens).map(([id, s]) => [id, { title: s.title, subtitle: s.subtitle, states: ['default'] }])),
  glossary: adapter.glossary,
};

const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const head = `<script id="ui-adapter">window.__UI_ADAPTER__=${esc(JSON.stringify(runtimeAdapter))};</script>\n<script id="ui-runtime-boot">${esc(runtime)}</script>\n`;
const tail = `<script id="ui-runtime">${esc(runtime)}</script>\n<script type="application/json" id="ui-manifest">${esc(JSON.stringify(manifest, null, 1))}</script>\n`;

if (!/<head[^>]*>/i.test(html) || !/<\/body>/i.test(html)) throw new Error('input needs <head> and </body>');
if (/id="ui-adapter"/.test(html)) throw new Error('input is already migrated');
const out = html.replace(/<head[^>]*>/i, (m) => `${m}\n${head}`).replace(/<\/body>(?![\s\S]*<\/body>)/i, `${tail}</body>`);
writeFileSync(outFile, out);
console.log(JSON.stringify({ out: outFile, screens: Object.keys(screens).length, flows: flows.length,
  components: adapter.components.length, icons: Object.keys(icons).length, bytes: out.length }));
