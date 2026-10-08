#!/usr/bin/env node
// The skill's self-check. Prepares the read-only audit scripts (figma/audit.js) with what the
// file SHOULD hold — the inventory (adapter), the browser census of every screen, the page
// layout — and turns their results into a pass/fail report.
//
//   node audit.mjs prepare <work-dir> <map-dir> <out-dir>     → <out-dir>/A1-components.js, A2-screens-*.js, A3-pages.js,
//                                                                A4-geometry-*.js
//   (run them with use_figma; save each result as <out-dir>/results/<script>.json)
//   node audit.mjs report  <work-dir> <out-dir>                → <out-dir>/audit.json + audit.md, exit 1 on any failure
//
// The census counts only what a screen shows (the capture map), so "InboxRow 27/27" means the
// 27 rows the browser drew are 27 instances in the frame.
//
// Thresholds and the outputs to expect come from state.options (set from the user's config):
// audit.tolerancePx, audit.minScreenPct, audit.systematicScreens; outputs.darkScreens,
// outputs.flowMap, outputs.cover, outputs.foundations. An older state gets the defaults below.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelsFor, topicOrder, orderStages } from './lib/labels.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [cmd, work, a3, a4] = process.argv.slice(2);
const W = (...p) => path.join(work, ...p);
const state = JSON.parse(readFileSync(W('state.json'), 'utf8'));
const adapter = JSON.parse(readFileSync(W(state.adapter), 'utf8'));
// screens new in this run are in next/plan.json (frames) until promote stores them in state.json:
// without them the first build's audit would check no screen at all
const planFile = W('next', 'plan.json');
const SCREENS = { ...(existsSync(planFile) ? JSON.parse(readFileSync(planFile, 'utf8')).frames || {} : {}), ...state.screens };
const screenGroups = () => (existsSync(W('groups.json')) ? JSON.parse(readFileSync(W('groups.json'), 'utf8')) : state.groups || []);
const STYLE = state.style || { pageBg: '#cacaca', sectionFill: '#bdbdbd' };
import { run } from './lib/fill.mjs';
import { censusOf, geoOf } from './lib/dom-map.mjs';
// the audit runs installed (sync's 00-install-* includes audit.js and geometry.js): each script carries its PARAMS only
const fill = (params) => run('audit.js', params);
const OPT = state.options || {};
const AUD = { tolerancePx: 2, minScreenPct: 90, systematicScreens: 3, ...(OPT.audit || {}) };
const OUT = { cover: true, foundations: true, flowMap: true, darkScreens: true, prototypeLinks: true, ...(OPT.outputs || {}) };
const LBL = labelsFor(state);
// the share of the components the browser drew that sit where it drew them (within tolerancePx)
const GEOMETRY_MIN = AUD.minScreenPct;
const TOL = AUD.tolerancePx;
// a component off on this many screens or more is one systematic defect
const SYSTEMATIC = AUD.systematicScreens;
// a component's board: `stage` in the adapter (`etapa` in older adapters)
const stageOf = (c) => c.stage || c.etapa;

if (cmd === 'prepare') {
  const [mapDir, outDir] = [a3, a4];
  mkdirSync(outDir, { recursive: true });
  const expected = adapter.components.map((c) => ({ ui: c.ui, kind: c.kind, stage: stageOf(c) }));
  // the boards' order is the one organize laid out (the stage notes keep it), else first use
  const order = state.stageNotes && Object.keys(state.stageNotes).length ? Object.keys(state.stageNotes) : orderStages(LBL, adapter.components.map(stageOf).filter(Boolean));
  writeFileSync(path.join(outDir, 'A1-components.js'), fill({ scope: 'components', page: state.pages.components, expected, order: order.concat(LBL.iconsBoard.name), style: STYLE }));
  // census: per screen, how many of each component the browser drew
  const census = {}, slack = {};
  for (const f of readdirSync(mapDir).filter((x) => /^\d\d-.*\.json$/.test(x))) {
    const m = JSON.parse(readFileSync(path.join(mapDir, f), 'utf8'));
    const id = SCREENS[m.screen] && SCREENS[m.screen].frame;
    if (!id) continue;
    const cs = censusOf(m);
    census[id] = cs.census; slack[id] = cs.slack;
  }
  const frames = Object.keys(census);
  // what the report must find results for: a map whose screen has no frame is a screen nobody checks
  const mapped = readdirSync(mapDir).filter((x) => /^\d\d-.*\.json$/.test(x)).map((f) => JSON.parse(readFileSync(path.join(mapDir, f), 'utf8')).screen);
  writeFileSync(path.join(outDir, 'expect.json'), JSON.stringify({ screens: frames, unframed: mapped.filter((s) => !(SCREENS[s] && SCREENS[s].frame)) }, null, 1));
  for (let i = 0, k = 0; i < frames.length; i += 10, k++) {
    const chunk = frames.slice(i, i + 10);
    writeFileSync(path.join(outDir, `A2-screens-${String.fromCharCode(97 + k)}.js`),
      fill({ scope: 'screens', frames: chunk, census: Object.fromEntries(chunk.map((f) => [f, census[f]])), slack: Object.fromEntries(chunk.map((f) => [f, slack[f]])), style: STYLE,
        ...(OUT.darkScreens ? {} : { requireDark: false }) }));
  }
  // geometry: every tagged box the browser drew, in document order, with the scrollbar room of the
  // box that scrolls around it (the layer there may be that much wider in Figma)
  const geo = {};
  for (const f of readdirSync(mapDir).filter((x) => /^\d\d-.*\.json$/.test(x))) {
    const m = JSON.parse(readFileSync(path.join(mapDir, f), 'utf8'));
    const id = SCREENS[m.screen] && SCREENS[m.screen].frame;
    if (!id) continue;
    geo[id] = geoOf(m);
  }
  let chunk = {}, size = 0, gk = 0;
  const flushGeo = () => {
    if (!Object.keys(chunk).length) return;
    writeFileSync(path.join(outDir, `A4-geometry-${String.fromCharCode(97 + gk++)}.js`), run('geometry.js', { frames: chunk, tol: TOL }));
    chunk = {}; size = 0;
  };
  for (const [id, dom] of Object.entries(geo)) {
    const s = JSON.stringify(dom).length;
    if (size + s > (+process.env.GEO_CHUNK || 38000)) flushGeo();
    chunk[id] = dom; size += s;
  }
  flushGeo();
  // only the pages the project generates are audited (options.outputs)
  const pages = {
    ...(OUT.foundations ? { foundations: { id: state.pages.foundations, layout: 'row', order: topicOrder(LBL) } } : {}),
    // the Screens sections in groups.json order (the titles 09-layout-screens gives them), or
    // state.groups in projects that keep the order there
    screens: { id: state.pages.screens, layout: 'row', order: screenGroups().map((g) => g.title.replace(/ · .*/, '')) },
    ...(OUT.flowMap ? { flows: { id: state.pages.flows, layout: 'column' } } : {}),
    ...(OUT.cover ? { cover: { id: state.pages.cover, layout: 'row' } } : {}),
  };
  writeFileSync(path.join(outDir, 'A3-pages.js'), fill({ scope: 'pages', pages, style: STYLE }));
  console.log(JSON.stringify({ components: expected.length, screens: frames.length, scripts: readdirSync(outDir).filter((x) => x.endsWith('.js')).length }));
} else if (cmd === 'report') {
  const outDir = a3;
  const dir = path.join(outDir, 'results');
  const res = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))) : [];
  const checks = [], screens = [], geometry = [];
  let rows = [];
  for (const r of res) {
    if (r.checks) checks.push(...r.checks);
    if (r.rows) rows = r.rows;
    if (r.scope === 'geometry') geometry.push(...r.frames);
    else if (r.frames) screens.push(...r.frames);
  }
  const badScreens = screens.filter((s) => !s.ok);
  // coverage first: an audit that saw no screen (or only some) must not pass
  const expFile = path.join(outDir, 'expect.json');
  if (existsSync(expFile)) {
    const exp = JSON.parse(readFileSync(expFile, 'utf8'));
    const seen = new Set(screens.filter((s) => !s.missing).map((s) => s.id).filter(Boolean));
    const unseen = exp.screens.filter((id) => !seen.has(id));
    checks.push({ id: 'the audit covers every screen of the maps', ok: !exp.unframed.length && !unseen.length && (exp.screens.length > 0 || !exp.unframed.length),
      detail: [...exp.unframed.map((s) => `${s}: no frame known (not in state.json nor next/plan.json)`), ...unseen.map((id) => (screens.some((s) => s.id === id && s.missing) ? `${id}: frame not found in the file` : `${id}: no A2 result`))] });
  }
  checks.push({ id: 'every screen: components are instances (census = instances)', ok: !screens.some((s) => Object.keys(s.diff || {}).length), detail: badScreens.filter((s) => Object.keys(s.diff || {}).length).slice(0, 12).map((s) => `${s.name}: ${JSON.stringify(s.diff)}`) });
  checks.push({ id: 'every screen: no tagged copy left loose', ok: !screens.some((s) => Object.keys(s.loose || {}).length), detail: screens.filter((s) => Object.keys(s.loose || {}).length).slice(0, 12).map((s) => `${s.name}: ${JSON.stringify(s.loose)}`) });
  checks.push({ id: 'every scroll box is clipped and scrolls', ok: screens.every((s) => !s.scroll || s.scroll.n === s.scroll.clipped), detail: screens.filter((s) => s.scroll && s.scroll.n !== s.scroll.clipped).map((s) => s.name) });
  if (OUT.darkScreens) checks.push({ id: 'every screen has its dark copy', ok: screens.every((s) => s.dark), detail: screens.filter((s) => !s.dark).map((s) => s.name) });
  if (geometry.length) {
    // adj: strict, plus the boxes that sit where the capture drew them when the capture was within
    // its whole-pixel text drift of the browser (geometry.js: drift)
    const adj = (g) => (g.pctAdj !== undefined ? g.pctAdj : g.pct);
    const low = geometry.filter((g) => adj(g) < GEOMETRY_MIN).sort((a, b) => adj(a) - adj(b));
    const pairs = geometry.reduce((s, g) => s + g.pairs, 0), good = geometry.reduce((s, g) => s + g.good, 0), drift = geometry.reduce((s, g) => s + (g.drift || 0), 0);
    const share = (v) => Math.round(v / Math.max(pairs, 1) * 1000) / 10;
    checks.push({ id: `geometry: on every screen at least ${GEOMETRY_MIN} % of the components sit where the browser drew them (±${TOL} px, or where the capture drew them within its text-line drift)`, ok: !low.length,
      detail: [`total ${share(good + drift)} % of ${pairs} (strict ${share(good)} %, drift ${drift})`].concat(low.slice(0, 12).map((g) => `${g.name}: ${adj(g)} % (strict ${g.pct} %)`)) });
    // a component off on several screens is one defect, not many: its median offsets say which
    const per = {};
    for (const g of geometry) for (const [ui, b] of Object.entries(g.bad || {})) {
      const p = per[ui] = per[ui] || { screens: 0, off: 0, missing: 0, d: [] };
      p.screens++; p.off += b.off; p.missing += Math.max(0, b.n - b.m); p.d.push([b.dx, b.dy, b.dw, b.dh]);
    }
    const worst = Object.entries(per).filter(([, p]) => p.screens >= SYSTEMATIC || p.missing).sort((a, b) => b[1].off - a[1].off);
    checks.push({ id: `geometry: no component is off on ${SYSTEMATIC} or more screens, none missing`, ok: !worst.length,
      detail: worst.slice(0, 12).map(([ui, p]) => `${ui}: ${p.off} off on ${p.screens} screens${p.missing ? `, ${p.missing} missing` : ''}, e.g. dx/dy/dw/dh ${p.d[0].join('/')}`) });
  }
  const failed = checks.filter((c) => !c.ok);
  const md = ['| Check | Result | Detail |', '|---|---|---|',
    ...checks.map((c) => `| ${c.id} | ${c.ok ? 'OK' : 'FAIL'} | ${c.ok ? '' : String(Array.isArray(c.detail) ? c.detail.slice(0, 6).join('; ') : JSON.stringify(c.detail)).replace(/\|/g, '/').slice(0, 300)} |`)].join('\n');
  writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify({ checks, rows, screens, geometry }, null, 1));
  writeFileSync(path.join(outDir, 'audit.md'), md + '\n');
  console.log(md);
  console.log(JSON.stringify({ checks: checks.length, failed: failed.length, screens: screens.length, screensFailing: badScreens.length }));
  process.exit(failed.length ? 1 : 0);
} else {
  console.error('usage: audit.mjs prepare <work> <map-dir> <out-dir> | report <work> <out-dir>');
  process.exit(2);
}
