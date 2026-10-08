#!/usr/bin/env node
// Incremental update: compares a new version of the prototype with the last build and plans
// only the work that changed. Nothing in Figma is touched here; the plan lists what to run.
//
//   node sync.mjs detect   <work-dir> <new-source.html>
//   node sync.mjs figma    <work-dir> <captures.json> [--full] [--park] [--specimens <nodes.json> <mapDir>]
//   node sync.mjs figma    <work-dir> <captures.json> --late <screen,…> [--specimens <nodes.json> <mapDir>]
//   node sync.mjs escalate <work-dir> <n,…>
//   node sync.mjs promote  <work-dir>
//
// The screens come from the flows the adapter's route table is built from (state.flows): a flow
// that gains a step adds a screen, one that loses it removes its frames. A change to the look of a
// component that already exists (plan.lookChanged) makes the update full: every screen is
// captured again and the components are rebuilt; the frames keep their ids.
//
// <work-dir>/state.json holds the last build (see STATE below). `detect` builds the new
// version in <work-dir>/next/ (migrated HTML, tokens, DOM maps, reference shots), diffs it
// against the baseline and writes next/plan.json. After the plan is applied in Figma,
// `promote` makes next/ the new baseline.
//
// What counts as a change, strongest first:
//   tokens     — a :root custom property added, removed or resolving to another value
//   structure  — a screen's DOM map differs (boxes moved, resized, appeared, disappeared)
//   pixels     — same boxes, different paint (color, border, shadow, text)
//   none       — identical map and identical pixels in both themes: the frame is left alone
// Changes in the source that render nothing (comments, unused CSS) end up as "none".
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, renameSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as runTpl, installPlan, installCheck } from './lib/fill.mjs';
import { levelsFromMaps } from './lib/levels.mjs';
import { slotsOf, minWidthsOf } from './lib/dom-map.mjs';
import { labelsFor } from './lib/labels.mjs';
import { pixelShare } from './lib/pixel-diff.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [cmd, workDir, newSource] = process.argv.slice(2);
const W = (...p) => path.join(workDir, ...p);
const PATCH_MAX = 12;   // changed boxes a screen may have and still be patched instead of recaptured
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const node = (script, args) => execFileSync(process.execPath, [path.join(here, script), ...args], { cwd: workDir, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

const mapFile = (dir, i, screen) => path.join(dir, `${String(i + 1).padStart(2, '0')}-${screen.replace(/[^a-z0-9]+/gi, '_')}.json`);
const mapOf = (dir, screen) => {
  const suf = '-' + screen.replace(/[^a-z0-9]+/gi, '_') + '.json';
  const f = readdirSync(dir).find((x) => /^\d+-/.test(x) && x.slice(x.indexOf('-')) === suf);
  return f ? path.join(dir, f) : null;
};
const shotFile = (dir, theme, screen) => path.join(dir, `${theme}_${screen.replace(/\//g, '_')}.png`);

// STATE: { source, sourceSha, adapter, flows, baseUrl, width, height, themes,
//          screens: { "<screen id>": { frame, dark } }, maps: "map", shots: "shots" }
const state = JSON.parse(readFileSync(W('state.json'), 'utf8'));
// the texts written on the canvas (docs language) and which outputs the project wants; a state
// without options (an older project) gets every output, in English
const LBL = labelsFor(state);
const OUT = { cover: true, foundations: true, flowMap: true, darkScreens: true, prototypeLinks: true, ...((state.options || {}).outputs || {}) };
// a component's board: `stage` in the adapter (`etapa` in older adapters)
const stageOf = (c) => c.stage || c.etapa;

if (cmd === 'promote') {
  const next = W('next');
  if (!existsSync(path.join(next, 'plan.json'))) throw new Error('nothing to promote: run detect first');
  const plan = JSON.parse(readFileSync(path.join(next, 'plan.json'), 'utf8'));
  for (const f of ['orig.html', 'figma.html', 'tokens.json']) cpSync(path.join(next, f), W(f));
  for (const d of [state.maps, state.shots]) { rmSync(W(d), { recursive: true, force: true }); renameSync(path.join(next, d), W(d)); }
  state.sourceSha = plan.sourceSha;
  if (plan.adapterSha) state.adapterSha = plan.adapterSha;
  if (plan.flowsSha) state.flowsSha = plan.flowsSha;
  for (const s of plan.removed || []) delete state.screens[s];
  if (plan.frames) Object.assign(state.screens, plan.frames);
  // each light frame's dark copy, from the runner logs of the run and of the late path (in order:
  // a later dark of the same frame wins); replace-screen removes it by this id on the next update
  const byFrame = Object.fromEntries(Object.entries(state.screens).map(([s, v]) => [v.frame, s]));
  for (const g of ['gen', 'gen-late']) {
    const log = path.join(next, g, 'run.log');
    if (!existsSync(log)) continue;
    for (const line of readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (!/^08-dark/.test(e.file) || !e.result || typeof e.result !== 'object') continue;
      for (const f of e.result.frames || []) if (byFrame[f.light]) state.screens[byFrame[f.light]].dark = f.dark;
    }
  }
  if (plan.componentOrder) state.componentOrder = plan.componentOrder;
  writeFileSync(W('state.json'), JSON.stringify(state, null, 1));
  rmSync(next, { recursive: true, force: true });
  console.log(JSON.stringify({ promoted: plan.sourceSha.slice(0, 12) }));
  process.exit(0);
}

if (cmd === 'escalate') {
  // node sync.mjs escalate <work-dir> <n,…> — screens whose patch threw PATCH_UNMATCHED move to
  // the recapture list; rerun `figma` with capture ids for the new list afterwards.
  const file = W('next', 'plan.json');
  const plan = JSON.parse(readFileSync(file, 'utf8'));
  const ns = (process.argv[4] || '').split(',').map(Number);
  for (const r of plan.screens) if (ns.includes(r.n) && r.action === 'patch') r.action = 'recapture';
  plan.patch = plan.screens.filter((r) => r.action === 'patch').map((r) => r.screen);
  plan.recapture = plan.screens.filter((r) => r.action === 'recapture').map((r) => r.screen);
  writeFileSync(file, JSON.stringify(plan, null, 1));
  console.log(JSON.stringify({ recapture: plan.screens.filter((r) => r.action === 'recapture').map((r) => r.n), patch: plan.patch.length }));
  process.exit(0);
}

if (cmd === 'figma') {
  // node sync.mjs figma <work-dir> <captures.json | captureFrameId,…>  — the fresh captures: a
  // JSON file { "<screen>": "<capture frame id>" } (capture/nodes.json, or the `captures` of the
  // figma/find-captures.js scan, which wins when they disagree) or, legacy, ids in the order of
  // plan.recapture. Writes the use_figma scripts to next/gen/, in the order to run.
  const next = W('next');
  const plan = JSON.parse(readFileSync(path.join(next, 'plan.json'), 'utf8'));
  // --late <screen,…>: screens whose capture landed after the run (a stalled conversion) go in on
  // the components it built — the same steps as an update limited to them: what they bring that
  // the file lacks is built, the rest swapped; then the parked components' page goes when nothing
  // uses them any more. Scripts in next/gen-late/, the run's own next/gen/ stays as it was
  const li = process.argv.indexOf('--late');
  const late = li > 0 ? process.argv[li + 1].split(',').filter(Boolean) : null;
  if (late) {
    Object.assign(plan, { recapture: late, patch: [], retag: [], removed: [], tokens: { added: [], removed: [], changed: [] } });
    for (const [s, f] of Object.entries(plan.frames || {})) if (!state.screens[s]) state.screens[s] = f;
  }
  const full = !late && (process.argv.includes('--full') || !!plan.full);   // first build: every screen, components from scratch
  if (full) { plan.recapture = [...Object.keys(state.screens).filter((s) => !(plan.removed || []).includes(s)), ...(plan.added || []).filter((s) => !state.screens[s])]; plan.patch = []; plan.retag = []; }
  const capArg = process.argv[4] || '';
  let temps;
  if (capArg.endsWith('.json')) {
    const raw = JSON.parse(readFileSync(path.resolve(capArg), 'utf8'));
    const cap = raw.captures || raw;
    const missing = plan.recapture.filter((s) => !cap[s]);
    if (missing.length) throw new Error(`no capture for ${missing.length} screens: ${missing.slice(0, 8).join(', ')}`);
    temps = plan.recapture.map((s) => cap[s]);
  } else temps = capArg.split(',').filter(Boolean);
  if (temps.length !== plan.recapture.length) throw new Error(`expected ${plan.recapture.length} capture ids, got ${temps.length}`);
  const gen = path.join(next, late ? 'gen-late' : 'gen');
  rmSync(gen, { recursive: true, force: true }); mkdirSync(gen, { recursive: true });
  // every step runs an installed template (00-install-* stores them in the file once): each
  // call then carries only its PARAMS
  const usedTpl = new Set();
  const fill = (tpl, params) => { usedTpl.add(tpl); return runTpl(tpl, params); };
  const STYLE = state.style || { pageBg: '#cacaca', sectionFill: '#bdbdbd', title: '#1a1c1f', subtle: '#3d3f42', gap: 200 };
  // list components (a table and its row component) from the adapter: { "ProductTable": "ProductRow" }
  const lists = Object.fromEntries((JSON.parse(readFileSync(W(state.adapter), 'utf8')).components || []).filter((c) => c.list).map((c) => [c.ui, c.list]));
  const order = [];
  const put = (name, code) => { writeFileSync(path.join(gen, name), code); order.push(name); };
  // one use_figma call has a time budget: screen-wide passes run in batches of screens
  const BATCH = 10;
  const chunks = (l) => { const o = []; for (let i = 0; i < l.length; i += BATCH) o.push(l.slice(i, i + BATCH)); return o; };
  const putEach = (name, list, make) => {
    const cs = chunks(list);
    cs.forEach((c, i) => put(cs.length > 1 ? name.replace('.js', `-${String.fromCharCode(97 + i)}.js`) : name, make(c)));
  };
  const S = state.screens;
  // screens the flows no longer have: their frames (light and dark) leave the Screens page, and
  // nothing after this (wire, validate, layout) looks for them
  const gone = (plan.removed || []).filter((s) => S[s]);
  if (gone.length) {
    put('01a-remove.js', `const ids = ${JSON.stringify(gone.flatMap((s) => [S[s].frame, S[s].dark].filter(Boolean)))};
const out = { removed: [] };
for (const id of ids) { const n = await figma.getNodeByIdAsync(id); if (n) { n.remove(); out.removed.push(id); } }
return out;
`);
    for (const s of gone) delete S[s];
  }
  // a screen new to the file has no frame yet: its capture becomes its frame
  const added = new Set(plan.added || []);
  plan.frames = plan.frames || {};
  plan.recapture.forEach((s, i) => { if (added.has(s) && !S[s]) { S[s] = { frame: temps[i] }; plan.frames[s] = { frame: temps[i] }; } });
  writeFileSync(path.join(next, 'plan.json'), JSON.stringify(late ? { ...JSON.parse(readFileSync(path.join(next, 'plan.json'), 'utf8')), frames: plan.frames } : plan, null, 1));
  const nextManifest = JSON.parse(readFileSync(path.join(next, state.maps, 'manifest.json'), 'utf8'));
  const titleOf = (s) => ((nextManifest.screens || {})[s] || {}).title || s;
  if (plan.tokens.added.length + plan.tokens.removed.length + plan.tokens.changed.length) {
    put('00-variables.js', node('gen-variables.mjs', [path.join(next, 'tokens.json')]));
  }
  // components, one nesting level at a time (inner first): L<k>-build sees every occurrence of the
  // level in the screens of this run and makes the variants, L<k>-swap puts instances in their
  // place in batches of screens. Heights come from the DOM maps (a host sits above its parts).
  const adapter = JSON.parse(readFileSync(W(state.adapter), 'utf8'));
  const kindOf = Object.fromEntries((adapter.components || []).map((c) => [c.ui, c.kind || (c.list ? 'list' : 'component')]));
  const codeRefs = Object.fromEntries((adapter.components || []).map((c) => [c.ui, `${c.sel} · data-ui ${c.ui}`]));
  const levelsOf = (mapDir, only) => levelsFromMaps(readdirSync(mapDir).filter((x) => /^\d.*\.json$/.test(x))
    .map((f) => JSON.parse(readFileSync(path.join(mapDir, f), 'utf8'))).filter((m) => !only || only.has(m.screen)));
  const putLevels = (frameIds, screensInRun) => {
    const levels = levelsOf(path.join(next, state.maps), new Set(screensInRun));
    const allMaps = readdirSync(path.join(next, state.maps)).filter((x) => /^\d.*\.json$/.test(x)).map((f) => JSON.parse(readFileSync(path.join(next, state.maps, f), 'utf8')));
    const minW = minWidthsOf(allMaps, adapter);
    for (const L of Object.keys(levels).sort((a, b) => a - b)) {
      const ui = levels[L].sort();
      const kinds = Object.fromEntries(ui.map((u) => [u, kindOf[u] || 'component']));
      const pl = Object.fromEntries(ui.filter((u) => lists[u]).map((u) => [u, lists[u]]));
      // a component's variants depend only on its own occurrences, so a level builds in parts: at
      // most 10 components per call (one call for a whole level of 66 components on 83 screens
      // dropped the transport twice and saved nothing; 10 per call take 5–16 s)
      // up to 10 light components per call; from level 2 up one per call (a whole level dropped
      // the transport, 8 heavy containers in one call hit a Figma error). A call that runs out of
      // its budget returns _pending and is sent again
      const per = +L >= 2 ? 1 : 10;
      for (let i = 0, k = 0; i < ui.length; i += per, k++) {
        const part = ui.slice(i, i + per);
        put(`L${L}-build-${String.fromCharCode(97 + k)}${per === 1 ? '-' + part[0] : ''}.js`, fill('build-level.js', { ui: part, kinds, lists: pl, screens: frameIds, componentsPage: state.pages.components,
          codeRefs: Object.fromEntries(part.map((u) => [u, codeRefs[u]])), keep: 5, origin: [0, 0], budgetMs: 25000,
          minW: Object.fromEntries(part.filter((u) => minW[u]).map((u) => [u, minW[u]])) }));
      }
      chunks(frameIds).forEach((c, i) => put(`L${L}-swap-${String.fromCharCode(97 + i)}.js`,
        fill('swap-level.js', { ui, kinds, lists: pl, screens: c, componentsPage: state.pages.components, budgetMs: 25000 })));
    }
  };
  if (plan.recapture.length) {
    const frames = plan.recapture.map((s) => S[s].frame);
    // captures were tagged (tagForCapture): identity is read from layer names, no DOM upload
    // --park: some screens still wait for their capture (a stalled conversion): the old components
    // move to a temporary page, flagged old (build and swap ignore them), so those screens keep
    // rendering until the late path brings them onto the new ones; then the page is deleted
    if (full && process.argv.includes('--park')) put('00-clear-components.js', `const page = await figma.getNodeByIdAsync(${JSON.stringify(state.pages.components)});
await figma.setCurrentPageAsync(page);
const board = page.findOne((n) => n.getSharedPluginData('uic', 'board') === 'icons');
const keep = new Set();
for (let p = board; p && p !== page; p = p.parent) keep.add(p.id);
let park = figma.root.children.find((p) => p.getSharedPluginData('uic', 'park') === '1');
if (!park) { park = figma.createPage(); park.name = ${JSON.stringify(LBL.parkPage)}; park.setSharedPluginData('uic', 'park', '1'); }
const owners = page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })
  .filter((n) => !(n.type === 'COMPONENT' && n.parent && n.parent.type === 'COMPONENT_SET') && !(board && board.findOne((x) => x === n)));
let x = 0;
for (const o of owners) { o.setSharedPluginData('uic', 'old', '1'); park.appendChild(o); o.x = x; o.y = 0; x += o.width + 200; }
let removed = 0;
const sweep = (parent) => { for (const c of [...parent.children]) { if (keep.has(c.id)) { if (c !== board && 'children' in c) sweep(c); continue; } c.remove(); removed++; } };
sweep(page);
return { moved: owners.length, removed, park: park.id };
`);
    else if (full) put('00-clear-components.js', `// full rebuild: every component goes except the icons (their board and the card holding it stay)
const page = await figma.getNodeByIdAsync(${JSON.stringify(state.pages.components)});
await figma.setCurrentPageAsync(page);
const board = page.findOne((n) => n.getSharedPluginData('uic', 'board') === 'icons');
const keep = new Set();
for (let p = board; p && p !== page; p = p.parent) keep.add(p.id);
let removed = 0;
const sweep = (parent) => { for (const c of [...parent.children]) { if (keep.has(c.id)) { if (c !== board && 'children' in c) sweep(c); continue; } c.remove(); removed++; } };
sweep(page);
return { removed };
`);
    put('01-replace.js', fill('replace-screen.js', { page: state.pages.screens,
      pairs: plan.recapture.map((s, i) => [temps[i], S[s].frame, S[s].dark || null]),
      // new screens: named and laid out in rows of the section, flow by flow
      place: { section: state.section, cols: 12, gapX: 200, rowH: 2 * state.height + 600 },
      titles: Object.fromEntries(plan.recapture.filter((s) => added.has(s)).map((s) => [S[s].frame, titleOf(s)])) }));
    putEach('02-tags.js', frames, (c) => fill('read-tags.js', { screens: c }));
    // right-aligned and centered texts back in their browser box: the capture sizes a text to its
    // glyphs, so a right-aligned figure drifts left when the font differs a hair
    const boxes = {};
    for (const f of readdirSync(path.join(next, state.maps)).filter((f) => /^\d/.test(f))) {
      const m = JSON.parse(readFileSync(path.join(next, state.maps, f), 'utf8'));
      if (!S[m.screen] || !plan.recapture.includes(m.screen)) continue;
      boxes[S[m.screen].frame] = m.nodes.filter((n) => n.ta && n.tx).map((n) => {
        const [pl, pr] = n.pad || [0, 0];
        return [Math.round((n.r[0] + pl) * 10) / 10, Math.round(n.r[1] * 10) / 10, Math.round((n.r[2] - pl - pr) * 10) / 10, n.ta, n.tx];
      });
    }
    putEach('02b-text.js', frames, (c) => fill('fix-text-boxes.js', { frames: Object.fromEntries(c.map((f) => [f, boxes[f] || []])) }));
    putEach('03-icons.js', frames, (c) => fill('build-icons.js', { screens: c, componentsPage: state.pages.components }));
    // a full build makes every component from all screens; an update builds only what these
    // screens bring that the file lacks, and swaps the rest (a new structure becomes a variant)
    putLevels(frames, plan.recapture);
    // --specimens <nodes.json> <mapDir>: the components the code has and no flow screen shows,
    // captured from a band of extra routes (the specimen sheet), go through every level after the
    // screens — what exists is swapped, what is missing is built — and then leave the file
    const si = process.argv.indexOf('--specimens');
    if ((full || late) && si > 0) {
      const specNodes = JSON.parse(readFileSync(path.resolve(process.argv[si + 1]), 'utf8'));
      const specDir = path.resolve(process.argv[si + 2]);
      const sframes = Object.values(specNodes);
      const read = (d) => readdirSync(d).filter((x) => /^\d.*\.json$/.test(x)).map((f) => JSON.parse(readFileSync(path.join(d, f), 'utf8')));
      const lv = levelsFromMaps([...read(path.join(next, state.maps)), ...read(specDir)]);
      put('04s-a-tags.js', fill('read-tags.js', { screens: sframes }));
      put('04s-b-icons.js', fill('build-icons.js', { screens: sframes, componentsPage: state.pages.components }));
      for (const L of Object.keys(lv).sort((a, b) => a - b)) {
        const ui = lv[L].sort(), tag = String(L).padStart(3, '0');
        const kinds = Object.fromEntries(ui.map((u) => [u, kindOf[u] || 'component']));
        const pl = Object.fromEntries(ui.filter((u) => lists[u]).map((u) => [u, lists[u]]));
        put(`04s-c-L${tag}-build.js`, fill('build-level.js', { ui, kinds, lists: pl, screens: sframes, componentsPage: state.pages.components,
          codeRefs: Object.fromEntries(ui.map((u) => [u, codeRefs[u]])), keep: 5, origin: [0, 0], budgetMs: 25000, minW: {} }));
        put(`04s-c-L${tag}-swap.js`, fill('swap-level.js', { ui, kinds, lists: pl, screens: sframes, componentsPage: state.pages.components, budgetMs: 25000 }));
      }
      put('04s-z-remove.js', `const ids = ${JSON.stringify(sframes)};
const out = { removed: [] };
for (const id of ids) { const n = await figma.getNodeByIdAsync(id); if (n && n.type === 'FRAME') { n.remove(); out.removed.push(id); } }
return out;
`);
    }
  }
  const retag = plan.retag || [];
  if (retag.length) {
    putEach('02-retag.js', retag, (c) => fill('retag-screen.js', {
      screens: c.map((s) => ({ frame: S[s].frame, ops: plan.screens.find((x) => x.screen === s).ops })) }));
    putLevels(retag.map((s) => S[s].frame), retag);
  }
  // components built or changed: bind their raw values to tokens, then lay the page out in the
  // house style — one board per stage (adapter "stage"), in one row
  if (full || (plan.retag || []).length || plan.componentsTouched.length || plan.recapture.length) {
    put('05y-tokenize.js', fill('tokenize-components.js', { page: state.pages.components, collection: 'Tokens', only: null }));
    const uses = {}, scr = {};
    for (const f of readdirSync(path.join(next, state.maps)).filter((f) => /^\d/.test(f))) {
      const m = JSON.parse(readFileSync(path.join(next, state.maps, f), 'utf8'));
      for (const n of m.nodes) if (n.ui) { uses[n.ui] = (uses[n.ui] || 0) + 1; (scr[n.ui] = scr[n.ui] || new Set()).add(m.screen); }
    }
    const stages = [...new Set(adapter.components.map(stageOf).filter(Boolean))];
    const DESC = state.stageNotes || {};
    put('05z-organize.js', fill('organize-components.js', { page: state.pages.components, collection: 'Tokens', notes: {},
      uses: Object.fromEntries(Object.entries(uses).map(([k, v]) => [k, LBL.usesOnScreens(v, scr[k].size)])),
      categories: [...stages.map((e) => ({ name: e, desc: DESC[e] || '', items: adapter.components.filter((c) => stageOf(c) === e).map((c) => c.ui) })),
        { name: LBL.iconsBoard.name, desc: LBL.iconsBoard.desc, items: ['frame:Icons'] }],
      rowWidth: 3200, setWidth: 2400, style: STYLE, text: LBL.organize }));
  }
  for (const s of plan.patch) {
    const r = plan.screens.find((x) => x.screen === s);
    put(`04-patch-${String(r.n).padStart(2, '0')}.js`, fill('patch-screen.js', { frame: S[s].frame, ops: r.ops }));
  }
  const touched = [...plan.recapture, ...plan.patch, ...(plan.retag || [])];
  if (touched.length && OUT.darkScreens) putEach('08-dark.js', touched.map((s) => S[s].frame), (c) => fill('dark-frames.js', { frames: c, collection: 'Tokens', mode: 'Dark', gap: 200 }));
  // the prototype is wired LAST, from the link table and each link's box: a component main made
  // from a linked occurrence would otherwise pass the link to every instance, and the swap
  // replaces the layers that held reactions. Every link is rewired, so it is safe to re-run.
  // (options.outputs.prototypeLinks false: the slot texts are still verified, nothing is wired)
  {
    const links = JSON.parse(readFileSync(path.join(next, state.maps, 'links.json'), 'utf8'))
      .filter((l) => S[l.from] && S[l.to] && l.r)
      .map((l) => ({ from: l.from, to: l.to, r: l.r.map(Math.round), kind: l.kind, ...(l.gesture ? { gesture: l.gesture } : {}) }))
      // one element leads to one screen: when several links sit on the same box (the search
      // field typed two ways, a rail row that is both "next" and a root), the flow step wins,
      // then "next", then the global one; ties keep the first in flow order
      .sort((a, b) => ({ flow: 0, next: 1, global: 2 }[a.kind] ?? 3) - ({ flow: 0, next: 1, global: 2 }[b.kind] ?? 3))
      .filter((l, i, all) => all.findIndex((m) => m.from === l.from && m.r.join() === l.r.join()) === i)
      .map(({ kind, ...l }) => l);
    const manifest = JSON.parse(readFileSync(path.join(next, state.maps, 'manifest.json'), 'utf8'));
    // a flow starting point for each flow whose every screen is in the file (one per frame)
    const starts = new Set();
    const flows = manifest.flows.filter((f) => f.steps.every((st) => S[st.screen]))
      .map((f) => ({ name: f.title, start: S[f.steps[0].screen].frame }))
      .filter((f) => !starts.has(f.start) && starts.add(f.start));
    // every instance's slot texts against the browser's, for the screens that were rebuilt
    const slotUis = new Set((adapter.components || []).filter((c) => c.slots).map((c) => c.ui));
    const slots = {};
    for (const f of readdirSync(path.join(next, state.maps)).filter((f) => /^\d/.test(f))) {
      const m = JSON.parse(readFileSync(path.join(next, state.maps, f), 'utf8'));
      if (!S[m.screen] || ![...plan.recapture, ...plan.patch, ...(plan.retag || [])].includes(m.screen)) continue;
      // every occurrence of a slotted component, with or without texts: order pairing needs the whole list
      slots[S[m.screen].frame] = slotsOf(m, slotUis);
    }
    // four screens per call: ten carried 51 kB of slot texts, past use_figma's limit
    const vs = Object.keys(slots);
    for (let i = 0, k = 0; i < vs.length; i += 4, k++) put(`06-verify-${String.fromCharCode(97 + k)}.js`, fill('verify-slots.js', { page: state.pages.screens,
      slots: Object.fromEntries(vs.slice(i, i + 4).map((f) => [f, slots[f]])) }));
    // the late path rewires only its own screens: the others kept their layers, and a link into a
    // late screen targets its frame, whose id the replace kept
    const wired = OUT.prototypeLinks ? late || Object.keys(S) : [];
    putEach('10-validate-links.js', wired, (c) => fill('validate-links.js', {
      page: state.pages.screens, frames: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.frame])), only: c,
      links: links.filter((l) => c.includes(l.from)).map((l) => ({ from: l.from, to: l.to, r: l.r.map(Math.round) })) }));
    const allF = Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.frame]));
    putEach('07-wire.js', wired, (c) => fill('wire-links.js', { page: state.pages.screens, componentsPage: state.pages.components,
      frames: allF, links: links.filter((l) => c.includes(l.from)), flows, only: c.map((k) => allF[k]) }));
  }
  if (OUT.foundations && plan.tokens.added.length + plan.tokens.removed.length + plan.tokens.changed.length) {
    // only the color board depends on tokens; type and spacing boards follow the census and CSS
    // and are rebuilt with gen-foundations.mjs on their own (see SKILL.md, Foundations)
    const fdir = path.join(gen, 'foundations');
    node('gen-foundations.mjs', [next, fdir, '--state', W('state.json'), '--census', W('type-census.json')]);
    put('09-foundations.js', readFileSync(path.join(fdir, 'F1-color.js'), 'utf8'));
  }
  // the Screens page in the house layout: one section per app (groups.json), screens named by the
  // flow step where they first appear, each dark copy under its light frame
  if (touched.length && existsSync(W('groups.json'))) {
    const groups = JSON.parse(readFileSync(W('groups.json'), 'utf8'));
    const mf = JSON.parse(readFileSync(path.join(next, state.maps, 'manifest.json'), 'utf8'));
    const seen = new Set();
    const G = groups.map((g) => ({ title: g.title.replace(/ · .*/, ''), hue: g.hue, screens: [] }));
    groups.forEach((g, gi) => g.flows.forEach((key) => {
      const f = mf.flows.find((x) => x.key === key);
      if (f) f.steps.forEach((st, i) => {
        if (seen.has(st.screen) || !S[st.screen]) return;
        seen.add(st.screen);
        G[gi].screens.push({ frame: S[st.screen].frame, name: `${key}·${i + 1} · ${(mf.screens[st.screen] || {}).title || st.screen}` });
      });
    }));
    for (const g of G) g.sub = LBL.screens.groupSub(g.screens.length, OUT.darkScreens);
    put('09-layout-screens.js', fill('layout-screens.js', { page: state.pages.screens, groups: G, cols: 4, gapX: 160, gapY: 240, darkGap: 80, style: STYLE,
      darkSuffix: LBL.screens.darkSuffix }));
  }
  // the User flows page shows CLONES of the screens and the cover indexes them: any screen rebuilt,
  // added or removed leaves both stale (a sync that rebuilt most screens left the flow map showing
  // the old ones). Both are regenerated from the frames as they are after this run, last of the
  // canvas work (the clones copy the finished screens). Each follows its options.outputs switch.
  const docs = touched.length || gone.length || added.size;
  if (docs && ((OUT.flowMap && state.pages.flows) || (OUT.cover && state.pages.cover))) {
    const st = path.join(next, 'state.docs.json');
    writeFileSync(st, JSON.stringify({ ...state, screens: S }, null, 1));
    if (OUT.flowMap && state.pages.flows) {
      const fdir = path.join(gen, 'flowmap');
      const fargs = [path.join(next, state.maps), st, state.pages.flows, fdir];
      if (existsSync(W('groups.json'))) fargs.push('--groups', W('groups.json'));
      if (existsSync(W('compact.json'))) fargs.push('--compact', W('compact.json'));
      node('gen-flowmap.mjs', fargs);
      for (const f of readdirSync(fdir).filter((x) => x.endsWith('.js')).sort()) put('13-flowmap-' + f.replace('.figma.js', '.js'), readFileSync(path.join(fdir, f), 'utf8'));
    }
    if (OUT.cover && state.pages.cover) {
      const ddir = path.join(gen, 'cover');
      node('gen-docs.mjs', [path.join(next, state.maps), st, ddir]);
      put('14-cover.js', readFileSync(path.join(ddir, 'cover.figma.js'), 'utf8'));
    }
  }
  // the parked components (--park) leave with their page once no instance outside it uses them
  if (late) put('99-drop-park.js', `const park = figma.root.children.find((p) => p.getSharedPluginData('uic', 'park') === '1');
if (!park) return { park: null };
await figma.setCurrentPageAsync(park);
const used = {};
for (const c of park.findAllWithCriteria({ types: ['COMPONENT'] })) {
  for (const i of await c.getInstancesAsync()) {
    let p = i; while (p && p.type !== 'PAGE') p = p.parent;
    if (p && p !== park) { const k = c.parent && c.parent.type === 'COMPONENT_SET' ? c.parent.name : c.name; used[k] = (used[k] || 0) + 1; }
  }
}
if (Object.keys(used).length) return { park: park.id, kept: true, used };
const first = figma.root.children.find((p) => p !== park);
await figma.setCurrentPageAsync(first);
park.remove();
return { park: park.id, removed: true };
`);
  // run order = step number; the component levels (L<k>) go between the icons and the patches
  const rank = (f) => (/^L\d/.test(f) ? '03z' + f.replace(/^L(\d+)/, (m, k) => k.padStart(3, '0')) : f);
  order.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
  // installs first, behind a check that names the ones the file already has (the runner skips them)
  const inst = installPlan([...usedTpl, 'audit.js', 'geometry.js'], 22000).map((x, i) => ({ ...x, name: `00-install-${String.fromCharCode(97 + i)}.js` }));
  inst.forEach((x, i) => { writeFileSync(path.join(gen, x.name), x.code); order.splice(i, 0, x.name); });
  writeFileSync(path.join(gen, '00-install-check.js'), installCheck(inst));
  order.unshift('00-install-check.js');
  // the audit goes last: its report says whether this run left the file the way the skill promises
  node('audit.mjs', ['prepare', path.resolve(workDir), path.resolve(next, state.maps), path.resolve(gen, 'audit')]);
  console.log(JSON.stringify({ run: order.map((f) => ({ file: f, bytes: readFileSync(path.join(gen, f)).length })),
    then: 'run gen/audit/*.js, save each result to gen/audit/results/<name>.json, then node audit.mjs report <work-dir> <gen>/audit' }, null, 1));
  process.exit(0);
}

if (cmd !== 'detect') { console.error('usage: sync.mjs detect <work-dir> <new-source.html> | promote <work-dir>'); process.exit(1); }

const src = readFileSync(newSource);
const srcSha = sha(src);
// every screen of the prototype belongs in the file: the ones not there yet are added (in flow
// order), even when the source did not change
// the screens come from the NEW flows: a flow can gain a screen (a new state) or lose one (a
// state the design no longer has); both are read from the migrated copy's ui-manifest below
const flowsSha = sha(readFileSync(W(state.flows)));
// the adapter decides which boxes are components: a new entry changes the file as much as a
// new source does (the layers get retagged), so its hash counts too
const adapterSha = sha(readFileSync(W(state.adapter)));
if (srcSha === state.sourceSha && adapterSha === state.adapterSha && flowsSha === state.flowsSha) { console.log(JSON.stringify({ changed: false })); process.exit(0); }

const next = W('next');
rmSync(next, { recursive: true, force: true });
mkdirSync(next, { recursive: true });
writeFileSync(path.join(next, 'orig.html'), src);

// 1. tokens
node('extract-tokens.mjs', [path.join(next, 'orig.html'), '--out', path.join(next, 'tokens.json')]);
const oldTok = JSON.parse(readFileSync(W('tokens.json'), 'utf8')).tokens;
const newTok = JSON.parse(readFileSync(path.join(next, 'tokens.json'), 'utf8')).tokens;
const byName = (l) => Object.fromEntries(l.map((t) => [t.name, t]));
const O = byName(oldTok), N = byName(newTok);
const tokens = {
  added: Object.keys(N).filter((k) => !O[k]),
  removed: Object.keys(O).filter((k) => !N[k]),
  changed: Object.keys(N).filter((k) => O[k] && JSON.stringify(O[k].values) !== JSON.stringify(N[k].values)),
};

// 2. migrated build, DOM maps and reference shots of the new version
node('migrate.mjs', [path.join(next, 'orig.html'), W(state.adapter), W(state.flows), path.join(next, 'figma.html')]);
const migrated = readFileSync(path.join(next, 'figma.html'), 'utf8');
const newManifest = JSON.parse(migrated.match(/<script type="application\/json" id="ui-manifest">([\s\S]*?)<\/script>/)[1].replace(/<\\\/script/gi, '</script'));
const removed = Object.keys(state.screens).filter((s) => !newManifest.screens[s]);
const added = Object.keys(newManifest.screens).filter((s) => !state.screens[s]);
const known = Object.keys(state.screens).filter((s) => newManifest.screens[s]);
const screens = [...known, ...added];
const jobs = screens.map((screen) => ({ screen, captureId: '' }));
writeFileSync(path.join(next, 'jobs.json'), JSON.stringify(jobs));
const baseUrl = state.baseUrl.replace(/[^/]+$/, 'next/figma.html');
node('capture-batch.mjs', [baseUrl, path.join(next, 'jobs.json'), path.join(next, state.maps), '--no-capture',
  '--width', String(state.width), '--height', String(state.height)]);
node('shoot-routes.mjs', [baseUrl, screens.join(','), path.join(next, state.shots), '--themes', state.themes.join(','),
  '--width', String(state.width), '--height', String(state.height)]);

// 3. per-screen diff (pixelShare: lib/pixel-diff.mjs, the share of pixels that moved by more than 8/255)

const result = [];
screens.forEach((screen, i) => {
  if (i >= known.length) {
    result.push({ screen, n: i + 1, kind: 'new', action: 'recapture', ops: null, pixels: {}, components: [] });
    return;
  }
  // by screen name, not index: the baseline was mapped in the old job order (removed screens included)
  const bf = mapOf(W(state.maps), screen);
  if (!bf) { result.push({ screen, n: i + 1, kind: 'new', action: 'recapture', ops: null, pixels: {}, components: [] }); return; }
  const before = JSON.parse(readFileSync(bf, 'utf8')).nodes;
  const after = JSON.parse(readFileSync(mapFile(path.join(next, state.maps), i, screen), 'utf8')).nodes;
  // the text looks (ts) are a style signal, not structure: an older baseline has none
  const bare = (l) => l.map(({ ts, ...n }) => n);
  const structure = JSON.stringify(bare(before)) !== JSON.stringify(bare(after));
  const px = {};
  for (const th of state.themes) px[th] = pixelShare(shotFile(W(state.shots), th, screen), shotFile(path.join(next, state.shots), th, screen));
  const pixels = Object.values(px).some((v) => v > 0);
  // which components moved or changed inside the screen: compare their boxes in order
  const comps = (nodes) => nodes.filter((n) => n.ui).map((n) => n.ui + '|' + n.r.map(Math.round).join(','));
  const cb = comps(before), ca = comps(after);
  const touched = [...new Set([...ca.filter((c) => !cb.includes(c)).map((c) => c.split('|')[0]),
    ...after.filter((n, k) => n.ui && before[k] && (before[k].ui !== n.ui || before[k].props !== n.props)).map((n) => n.ui)])];
  // A structure change that paints nothing new (a text box that got wider, same glyphs in the
  // same place) and touches few boxes is patched in place: the layers are resized/moved to the
  // new boxes. Anything visible, or a different set of boxes, is recaptured.
  let action = structure || pixels ? 'recapture' : 'none';
  let ops = null;
  const same = before.length === after.length && before.every((n, k) => n.name === after[k].name && n.d === after[k].d);
  const tagOf = (n) => JSON.stringify([n.ui || '', n.props || '', n.slots || {}]);
  // Only component identity changed (the adapter gained a component or a prop): the boxes and
  // pixels are the same, so the layers are tagged in place (retag) instead of recaptured.
  if (structure && !pixels && same && before.every((n, k) => JSON.stringify(n.r) === JSON.stringify(after[k].r))) {
    const idx = after.map((n, k) => (tagOf(n) !== tagOf(before[k]) && n.ui ? k : -1)).filter((k) => k >= 0);
    const keep = new Set();
    for (const k of idx) {
      keep.add(k);
      let d = after[k].d;
      for (let j = k - 1; j >= 0 && d > 0; j--) if (after[j].d < d) { keep.add(j); d = after[j].d; }
    }
    ops = [...keep].sort((a, b) => a - b).map((k) => ({ r: after[k].r.map(Math.round), d: after[k].d, name: after[k].name,
      tag: idx.includes(k) ? { ui: after[k].ui, props: after[k].props || '', slots: after[k].slots || {} } : null }));
    action = idx.length ? 'retag' : 'none';
  } else if (structure && !pixels && same) {
    const idx = before.map((n, k) => (JSON.stringify(n.r) !== JSON.stringify(after[k].r) ? k : -1)).filter((k) => k >= 0);
    if (idx.length <= PATCH_MAX) {
      // matcher entries: every ancestor of a changed box (they carry the drift), then the box
      const keep = new Set();
      for (const k of idx) {
        keep.add(k);
        let d = before[k].d;
        for (let j = k - 1; j >= 0 && d > 0; j--) if (before[j].d < d) { keep.add(j); d = before[j].d; }
      }
      ops = [...keep].sort((a, b) => a - b).map((k) => ({ r: before[k].r.map(Math.round), d: before[k].d,
        to: idx.includes(k) ? after[k].r.map((v) => Math.round(v * 10) / 10) : null, name: before[k].name }));
      action = 'patch';
    }
  }
  result.push({ screen, n: i + 1, kind: structure ? 'structure' : pixels ? 'pixels' : 'none', action, ops,
    pixels: Object.fromEntries(Object.entries(px).map(([k, v]) => [k, Math.round(v * 10000) / 100])), components: touched });
});

// 4. links whose source screen changed must be rewired (their layers are rebuilt)
const links = JSON.parse(readFileSync(path.join(next, state.maps, 'links.json'), 'utf8'));
const changedScreens = result.filter((r) => r.action === 'recapture').map((r) => r.screen);
const plan = {
  sourceSha: srcSha,
  adapterSha,
  tokens,
  screens: result,
  recapture: changedScreens,
  patch: result.filter((r) => r.action === 'patch').map((r) => r.screen),
  retag: result.filter((r) => r.action === 'retag').map((r) => r.screen),
  rewire: links.filter((l) => changedScreens.includes(l.from)).length,
  componentsTouched: [...new Set(result.flatMap((r) => r.components))],
  added,
  removed,
  flowsSha,
};
// components whose LOOK changed: build-level never rebuilds an owner that exists, so a new inner
// structure only adds a variant beside the old ones (which stay, unused) and a restyled text stays
// old in the main, carried by every instance as an override. Two signals, blind to plain data edits: a structure (the parts of an
// occurrence down to its nested components, by name) the baseline never had, and a text
// part of a component with a text look (size, weight, tracking, case) the baseline never had for
// it — a label that lost its capitals. Maps without text looks (older baselines) give only the first
const lookOf = (nodes, shapes, texts) => {
  const stack = [];
  nodes.forEach((n, k) => {
    while (stack.length && stack[stack.length - 1].d >= n.d) stack.pop();
    const owner = stack.length ? stack[stack.length - 1] : null;
    const own = n.ui ? n : owner;
    if (own && n.ts) { const key = own.ui + '|' + (n.ui ? ':root' : n.name); (texts[key] = texts[key] || new Set()).add(n.ts); }
    if (n.ui) {
      const parts = [];
      for (let j = k + 1, skip = -1; j < nodes.length && nodes[j].d > n.d; j++) {
        if (skip >= 0 && nodes[j].d > skip) continue;
        skip = nodes[j].ui ? nodes[j].d : -1;
        parts.push((nodes[j].d - n.d) + (nodes[j].ui ? ':' + nodes[j].ui : '.' + nodes[j].name));
      }
      (shapes[n.ui] = shapes[n.ui] || new Set()).add(parts.join(' '));
      stack.push(n);
    }
  });
};
{
  const bs = {}, bt = {}, as = {}, at = {};
  for (const r of result) {
    const bf = mapOf(W(state.maps), r.screen);
    if (!bf || r.kind === 'new') continue;
    lookOf(JSON.parse(readFileSync(bf, 'utf8')).nodes, bs, bt);
    lookOf(JSON.parse(readFileSync(mapFile(path.join(next, state.maps), r.n - 1, r.screen), 'utf8')).nodes, as, at);
  }
  const changed = new Set();
  for (const [ui, set] of Object.entries(as)) if (bs[ui] && [...set].some((x) => !bs[ui].has(x))) changed.add(ui);
  for (const [key, looks] of Object.entries(at)) {
    const was = bt[key];
    if (was && [...looks].some((x) => !was.has(x))) changed.add(key.split('|')[0]);
  }
  plan.lookChanged = [...changed].sort();
  if (changed.size && !plan.full) plan.full = `components changed: ${plan.lookChanged.slice(0, 12).join(', ')}${changed.size > 12 ? ` (+${changed.size - 12})` : ''}`;
}
if (plan.full) { plan.recapture = [...Object.keys(state.screens).filter((s) => !removed.includes(s)), ...added]; plan.patch = []; plan.retag = []; }
// a font-family token reaches every text layer, including the ones inside component mains;
// swap-existing only syncs layout, so the components have to be rebuilt from the new captures
const fontTokens = [...tokens.added, ...tokens.removed, ...tokens.changed].filter((t) => /^--font(?!-(size|weight))/.test(t));
if (fontTokens.length) {
  plan.full = `font token changed: ${fontTokens.join(', ')}`;
  plan.recapture = [...Object.keys(state.screens).filter((s) => !removed.includes(s)), ...added];
  plan.patch = []; plan.retag = [];
}
// build order, inner components first: a component's height is how many component levels it
// holds (an Avatar 0, an InboxRow 1, an InboxList 2). Hosts are built after their parts.
{
  const h = {};
  for (const f of readdirSync(path.join(next, state.maps)).filter((f) => /^\d/.test(f))) {
    const nodes = JSON.parse(readFileSync(path.join(next, state.maps, f), 'utf8')).nodes;
    const stack = [];   // open component ancestors: [depth, ui, height-below]
    const close = (d) => { while (stack.length && stack[stack.length - 1][0] >= d) { const [, u, hh] = stack.pop(); h[u] = Math.max(h[u] || 0, hh); if (stack.length) stack[stack.length - 1][2] = Math.max(stack[stack.length - 1][2], hh + 1); } };
    for (const n of nodes) { close(n.d); if (n.ui) stack.push([n.d, n.ui, 0]); }
    close(-1);
  }
  plan.componentOrder = Object.keys(h).sort((a, b) => h[a] - h[b] || a.localeCompare(b));
  plan.componentHeight = h;
}
writeFileSync(path.join(next, 'plan.json'), JSON.stringify(plan, null, 1));
console.log(JSON.stringify({
  changed: true,
  added: added.length,
  removed,
  full: plan.full || false,
  tokens: { added: tokens.added.length, removed: tokens.removed.length, changed: tokens.changed.length },
  recapture: changedScreens.length, patch: plan.patch.length, untouched: result.filter((r) => r.action === 'none').length,
  componentsTouched: plan.componentsTouched,
  screens: result.map((r) => `${String(r.n).padStart(2, '0')} ${r.action.padEnd(9)} ${r.kind.padEnd(9)} ${JSON.stringify(r.pixels)} ${r.screen}`),
}, null, 1));
