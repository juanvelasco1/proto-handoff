#!/usr/bin/env node
// Starts a project: one work folder per prototype, with the state.json the other scripts read.
// The per-project settings come from your config (see config.example.jsonc).
//
//   node init-project.mjs <project-name> <prototype.html>      create <workRoot>/<project-name>/
//   node init-project.mjs set-file   <dir> <figma-file-url>     remember the Figma design file
//   node init-project.mjs pages-script <dir>                    write gen/00-pages.js (run with use_figma)
//   node init-project.mjs set-pages  <dir> <result.json|'{…}'>  store the page ids it returned
//
// The original prototype is copied, never modified. The work folder never goes inside your
// project (captures and state would end up in its repository) nor in a temporary folder.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError, projectSettings } from './lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const fail = (msg) => { console.error(msg); process.exit(1); };
const version = (() => { try { return JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8')).version; } catch { return 'unknown'; } })();
const readState = (dir) => {
  const f = path.join(dir, 'state.json');
  if (!existsSync(f)) fail(`No state.json in ${dir}: is this a proto-handoff work folder?`);
  return JSON.parse(readFileSync(f, 'utf8'));
};
const writeState = (dir, state) => writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 1));
const insideGitRepo = (p) => {
  for (let d = path.resolve(p); ; d = path.dirname(d)) {
    if (existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
};

if (cmd === 'set-file') {
  const [dir, url] = rest;
  if (!dir || !url) fail('usage: init-project.mjs set-file <dir> <figma-file-url>');
  const m = String(url).match(/figma\.com\/(design|file|board|slides|make|proto)\/([A-Za-z0-9]+)/);
  const key = m ? m[2] : (/^[A-Za-z0-9]{10,}$/.test(url) ? url : null);
  if (!key) fail('That is not a Figma file link. Copy it from Figma: Share → Copy link (it looks like https://www.figma.com/design/<key>/<name>).');
  if (m && !['design', 'file'].includes(m[1])) fail(`That link is a Figma ${m[1]} file. The skill needs a Figma Design file (figma.com/design/…).`);
  const state = readState(dir);
  state.fileKey = key;
  writeState(dir, state);
  console.log(`Figma file stored (key ${key.slice(0, 4)}…). It stays in state.json on this computer only.`);
  process.exit(0);
}

if (cmd === 'pages-script') {
  const [dir] = rest;
  if (!dir) fail('usage: init-project.mjs pages-script <dir>');
  const state = readState(dir);
  const names = state.pageNames || { cover: 'Cover', foundations: 'Foundations', components: 'Components', screens: 'Screens', flows: 'User flows' };
  const code = `// use_figma — finds or creates the pages proto-handoff uses. Safe to run more than once.
const NAMES = ${JSON.stringify(names)};
const KNOWN = ${JSON.stringify(state.pages || {})};
const out = {}, created = [], reused = [];
const taken = new Set();
for (const [key, name] of Object.entries(NAMES)) {
  let p = KNOWN[key] ? await figma.getNodeByIdAsync(KNOWN[key]) : null;
  if (p && p.type !== 'PAGE') p = null;
  if (!p) p = figma.root.children.find((x) => x.name === name && !taken.has(x.id)) || null;
  // a brand-new file: its single empty first page becomes the cover
  if (!p && key === 'cover' && figma.root.children.length === 1 && figma.root.children[0].children.length === 0
      && !Object.values(NAMES).includes(figma.root.children[0].name)) { p = figma.root.children[0]; p.name = name; }
  if (!p) { p = figma.createPage(); p.name = name; created.push(name); } else reused.push(p.name);
  taken.add(p.id);
  out[key] = p.id;
}
return { pages: out, created, reused };
`;
  mkdirSync(path.join(dir, 'gen'), { recursive: true });
  const file = path.join(dir, 'gen', '00-pages.js');
  writeFileSync(file, code);
  console.log(file);
  process.exit(0);
}

if (cmd === 'set-pages') {
  const [dir, arg] = rest;
  if (!dir || !arg) fail('usage: init-project.mjs set-pages <dir> <result.json | \'{"pages":{…}}\'>');
  let data;
  try { data = JSON.parse(existsSync(arg) ? readFileSync(arg, 'utf8') : arg); } catch (e) { fail(`Could not read the result as JSON: ${e.message}`); }
  const pages = data.pages || data.result?.pages || data;
  const keys = ['cover', 'foundations', 'components', 'screens', 'flows'];
  const bad = keys.filter((k) => typeof pages[k] !== 'string' || !/^\d+:\d+$/.test(pages[k]));
  if (bad.length) fail(`Missing or invalid page ids for: ${bad.join(', ')}. Pass the object 00-pages.js returned.`);
  const state = readState(dir);
  state.pages = Object.fromEntries(keys.map((k) => [k, pages[k]]));
  writeState(dir, state);
  console.log(`Page ids stored: ${keys.map((k) => `${k} ${pages[k]}`).join(', ')}`);
  process.exit(0);
}

// init
const [name, source] = [cmd, rest[0]];
if (!name || !source || name.startsWith('-')) {
  fail('usage: init-project.mjs <project-name> <prototype.html>\n' +
    '       init-project.mjs set-file <dir> <figma-file-url>\n' +
    '       init-project.mjs pages-script <dir>\n' +
    '       init-project.mjs set-pages <dir> <result.json>');
}
if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)) fail(`"${name}" is not a valid project name: use letters, numbers, - and _ (up to 64), no spaces.`);
if (!existsSync(source) || !statSync(source).isFile()) fail(`Prototype not found: ${source}`);
if (!/\.html?$/i.test(source)) fail('The prototype must be a single .html file.');

let config;
try { ({ config } = loadConfig()); } catch (e) { if (e instanceof ConfigError) fail(e.message); throw e; }
const dir = path.join(config.workRoot, name);
if (existsSync(path.join(dir, 'state.json'))) {
  fail(`A project named "${name}" already exists at ${dir}.\nTo update it with a new version of the prototype, use: node scripts/update.mjs check "${dir}" <new.html>`);
}
const repo = insideGitRepo(dir);
if (repo) console.warn(`Warning: ${dir} is inside the git repository ${repo}. Captures and state could get committed; consider another workRoot.`);

mkdirSync(dir, { recursive: true });
copyFileSync(source, path.join(dir, 'orig.html'));
const sourceSha = createHash('sha256').update(readFileSync(path.join(dir, 'orig.html'))).digest('hex');
const state = {
  source: 'orig.html',
  sourceSha,
  adapter: 'adapter.json',
  flows: 'bands.json',
  ...projectSettings(config),
  maps: 'map',
  shots: 'shots',
  fileKey: '',
  pages: {},
  section: '',
  groups: [],
  stageNotes: {},
  screens: {},
  createdWith: `proto-handoff ${version}`,
};
writeState(dir, state);
console.log(JSON.stringify({ dir, source: path.resolve(source), viewport: `${state.width}×${state.height}`, docsLanguage: state.options.docsLanguage,
  next: ['node scripts/init-project.mjs set-file <dir> <figma-file-url>', 'node scripts/init-project.mjs pages-script <dir>  → run it with use_figma → set-pages'] }, null, 1));
