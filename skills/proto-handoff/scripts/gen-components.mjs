#!/usr/bin/env node
// Fills the build-components template for one batch of component names.
//   node gen-components.mjs <adapter.json> <frames.json> <componentsPageId> <Ui1,Ui2,…> > run.js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [adapterFile, framesFile, pageId, uiCsv] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const tpl = readFileSync(path.join(here, 'figma/build-components.js'), 'utf8');
const adapter = JSON.parse(readFileSync(adapterFile, 'utf8'));
const frames = JSON.parse(readFileSync(framesFile, 'utf8'));
const codeRefs = Object.fromEntries((adapter.components || []).map((c) => [c.ui, `${c.sel} · data-ui="${c.ui}"`]));
const ui = uiCsv.split(',');
const params = { ui, screens: Object.values(frames), componentsPage: pageId,
  codeRefs: Object.fromEntries(ui.map((u) => [u, codeRefs[u]]).filter(([, v]) => v)), origin: [0, 0] };
process.stdout.write(tpl.replace(/\/\*PARAMS\*\/[\s\S]*?\/\*END\*\//, JSON.stringify(params)));
