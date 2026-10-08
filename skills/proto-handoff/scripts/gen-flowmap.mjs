#!/usr/bin/env node
// Generates the use_figma scripts for the User flows page: a map of bands laid out like a
// screenshot flow map, but with the real vector screens instead of screenshots:
//   00-head      legend + index (links to every band), clears the page
//   NN-<key>     one band per flow: a SECTION with the light row on top and the dark row below,
//                step labels, subtitles and arrows labeled with the gesture; 'fan' flows open
//                from one screen into a stack. Bands are grouped by app (groups.json).
//   99-compact   the compact map to the right: one tree per app (root → its sections), half size,
//                light and dark columns side by side.
// Every screen on this page is a clone of its frame on the Screens page, so the instances stay
// linked to the components; clones carry no prototype reactions.
//
//   node gen-flowmap.mjs <map-dir> <state.json> <flowsPageId> <out-dir> [--groups groups.json] [--compact compact.json]
//
// groups.json:  [{ "title": "Orders", "hue": "#bb6ab4", "flows": ["F7", "F8", …] }]
// compact.json: [{ "title": "Orders", "hue": "#bb6ab4", "note": "…", "root": "<screen>", "children": ["<screen>", …] }]
//
// Texts come from the project's docs language (lib/labels.mjs) and colors from its house style
// (state.style): canvas, section fill, title and subtle inks.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { labelsFor } from './lib/labels.mjs';

const args = process.argv.slice(2);
const [mapDir, stateFile, flowsPage, outDir] = args;
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const manifest = JSON.parse(readFileSync(path.join(mapDir, 'manifest.json'), 'utf8'));
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const S = state.screens;
const groups = opt('--groups') ? JSON.parse(readFileSync(opt('--groups'), 'utf8')) : [{ title: '', hue: null, flows: manifest.flows.map((f) => f.key) }];
const compact = opt('--compact') ? JSON.parse(readFileSync(opt('--compact'), 'utf8')) : [];
const titleOf = (s) => (manifest.screens[s] || {}).title || s;
const subOf = (s) => (manifest.screens[s] || {}).subtitle || '';
const W = state.width || 1440, H = state.height || 900;
const L = labelsFor(state).flowmap;
const ST = { pageBg: '#cacaca', sectionFill: '#bdbdbd', title: '#1a1c1f', subtle: '#3d3f42', ...(state.style || {}) };
mkdirSync(outDir, { recursive: true });

const COMMON = `
const FONT = { family: 'Inter', style: 'Regular' }, BOLD = { family: 'Inter', style: 'Semi Bold' };
await figma.loadFontAsync(FONT); await figma.loadFontAsync(BOLD);
const page = await figma.getNodeByIdAsync(${JSON.stringify(flowsPage)});
await figma.setCurrentPageAsync(page);
// house style of the documentation pages: #cacaca canvas, #bdbdbd sections, inks that pass AA
// on the section gray (ink 9.1:1, muted 5.6:1, arrows 3.9:1)
const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const ST = ${JSON.stringify(ST)};
const INK = hex(ST.title), MUTED = hex(ST.subtle), LN = { r: 0.333, g: 0.341, b: 0.353 };
const HOUSE = [{ type: 'SOLID', color: hex(ST.sectionFill) }];
const section = () => { const s = figma.createSection(); s.fills = HOUSE; return s; };
const TX = ${JSON.stringify(L)};
// dark rows only when the project makes dark copies of its screens (outputs.darkScreens)
const DARK = ${JSON.stringify(state.options?.outputs?.darkScreens !== false)};
const text = (parent, chars, size, bold, color, x, y, width, name) => {
  const t = figma.createText(); parent.appendChild(t);
  t.fontName = bold ? BOLD : FONT; t.characters = chars || ' '; t.fontSize = size;
  t.fills = [{ type: 'SOLID', color: color || INK }];
  if (width) { t.textAutoResize = 'HEIGHT'; t.resize(width, t.height); }
  t.x = x; t.y = y; if (name) t.name = name;
  return t;
};
// arrow: a vector with the arrow cap on the last vertex only
const arrow = async (parent, x0, y0, dx, dy, name, head = true) => {
  const v = figma.createVector(); parent.appendChild(v); v.name = name;
  const a = { x: 0, y: dy < 0 ? -dy : 0 }, b = { x: dx, y: dy < 0 ? 0 : dy };
  const vx = (p, cap) => ({ x: p.x, y: p.y, strokeCap: cap, strokeJoin: 'MITER', cornerRadius: 0, handleMirroring: 'NONE' });
  await v.setVectorNetworkAsync({ vertices: [vx(a, 'NONE'), vx(b, head ? 'ARROW_LINES' : 'NONE')],
    segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } }], regions: [] });
  v.strokes = [{ type: 'SOLID', color: LN }]; v.strokeWeight = 3;
  v.x = x0; v.y = Math.min(y0, y0 + dy);
  return v;
};
// the real screen: a copy of its frame (dark: of its dark copy), no prototype on it
const tokens = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === 'Tokens');
// the dark copy is looked up by its darkOf tag, not by a stored id: the same run that rebuilds a
// screen makes its dark copy again (new id) before this page is drawn
let darkOf = null;
const darkFor = async (id) => {
  if (!darkOf) {
    darkOf = {};
    const sp = await figma.getNodeByIdAsync(${JSON.stringify(state.pages.screens)});
    if (sp) { await sp.loadAsync(); for (const n of sp.findAll((n) => n.type === 'FRAME' && !!n.getSharedPluginData('uic', 'darkOf'))) darkOf[n.getSharedPluginData('uic', 'darkOf')] = n; }
  }
  return darkOf[id] || null;
};
const screen = async (parent, ids, dark, x, y, scale, name) => {
  const d = dark ? await darkFor(ids.frame) : null;
  const src = d || await figma.getNodeByIdAsync(ids.frame);
  const c = src.clone(); parent.appendChild(c);
  if (dark && !d && tokens) { const m = tokens.modes.find((m) => m.name === 'Dark'); if (m) c.setExplicitVariableModeForCollection(tokens, m.modeId); }
  if (scale !== 1) c.rescale(scale);
  c.x = x; c.y = y; c.name = name; c.cornerRadius = 0; c.clipsContent = true;
  c.setSharedPluginData('uic', 'darkOf', ''); c.setSharedPluginData('uic', 'flowCopy', ids.frame);
  for (const n of c.findAll((n) => n.type !== 'SLOT' && (() => { try { return Array.isArray(n.reactions) && n.reactions.length > 0; } catch (e) { return false; } })())) await n.setReactionsAsync([]);
  return c;
};
const bottom = () => page.children.filter((c) => c.getSharedPluginData('uic', 'map') !== 'compact')
  .reduce((m, c) => Math.max(m, c.y + c.height), 0);
`;

// ——— 00 · legend + index ———
const bandsOrder = groups.flatMap((g) => g.flows.map((k) => ({ group: g, flow: manifest.flows.find((f) => f.key === k) })).filter((x) => x.flow));
const head = `// generated by gen-flowmap.mjs — legend and index; clears the page
${COMMON}
for (const c of [...page.children]) c.remove();
page.backgrounds = [{ type: 'SOLID', color: hex(ST.pageBg) }];
const sec = section(); page.appendChild(sec); sec.name = TX.headSection;
sec.x = 0; sec.y = 0; sec.setSharedPluginData('uic', 'map', 'head');
text(sec, ${JSON.stringify(manifest.name || L.defaultName)}, 64, true, null, 120, 100, 3000);
text(sec, ${JSON.stringify(manifest.summary || '')}, 24, false, MUTED, 120, 200, 2400);
// the second line describes the dark row: dropped when the project has no dark screens
const LEGEND = DARK ? TX.legend : TX.legend.filter((_, i) => i !== 1);
let y = 320;
text(sec, TX.howToRead, 32, true, null, 120, y, 1600); y += 64;
for (const l of LEGEND) { const t = text(sec, '· ' + l, 20, false, null, 120, y, 2400); y += t.height + 10; }
y += 40; text(sec, TX.index, 32, true, null, 120, y, 1600, TX.indexLayer); y += 64;
const INDEX = ${JSON.stringify(bandsOrder.map(({ group, flow }) => ({ key: flow.key, title: flow.title, n: flow.steps.length, group: group.title })))};
let last = null;
for (const b of INDEX) {
  if (b.group && b.group !== last) { y += 16; text(sec, b.group, 22, true, MUTED, 120, y, 1600); y += 40; last = b.group; }
  const t = text(sec, b.key + ' · ' + b.title + ' — ' + TX.screensCount.replace('{n}', b.n), 20, false, null, 150, y, 2400, TX.indexLayer + ' · ' + b.key);
  t.setSharedPluginData('uic', 'indexOf', b.key); y += t.height + 8;
}
sec.resizeWithoutConstraints(3400, y + 120);
return { head: sec.id };
`;
writeFileSync(path.join(outDir, '00-head.figma.js'), head);

// ——— one band per flow ———
const FW = W, FH = H, GAP = 400, PITCH = FW + GAP, PAD = 120, TOP = 210;
let n = 0;
let prevGroup = null;
for (const { group, flow } of bandsOrder) {
  n++;
  const steps = flow.steps.map((st, i) => ({ code: `${flow.key}·${i + 1}`, screen: st.screen, ids: S[st.screen] || null,
    title: titleOf(st.screen), sub: subOf(st.screen), via: st.via || '' }));
  const missing = steps.filter((s) => !s.ids).map((s) => s.screen);
  const fan = flow.kind === 'fan';
  const groupHead = group.title && group.title !== prevGroup ? { title: group.title, hue: group.hue } : null;
  prevGroup = group.title;
  const code = `// generated by gen-flowmap.mjs — band ${flow.key}
${COMMON}
const B = ${JSON.stringify({ key: flow.key, title: flow.title, note: flow.note || '', fan, steps, groupHead, missing })};
const FW = ${FW}, FH = ${FH}, GAP = ${GAP}, PITCH = ${PITCH}, PAD = ${PAD}, TOP = ${TOP};
let y0 = bottom() + 400;
if (B.groupHead) {
  // the app this group of bands belongs to
  const g = section(); page.appendChild(g); g.name = 'App · ' + B.groupHead.title; g.x = 0; g.y = y0;
  g.setSharedPluginData('uic', 'map', 'group');
  if (B.groupHead.hue) { const r = figma.createRectangle(); g.appendChild(r); r.resize(24, 96); r.x = 120; r.y = 60; r.fills = [{ type: 'SOLID', color: hex(B.groupHead.hue) }]; r.name = TX.colorTab; }
  text(g, B.groupHead.title, 80, true, null, 170, 50, 3000, 'app');
  g.resizeWithoutConstraints(3000, 220);
  y0 += 220 + 200;
}
const sec = section(); page.appendChild(sec);
sec.name = B.key + ' · ' + B.title; sec.x = 0; sec.y = y0; sec.setSharedPluginData('uic', 'map', 'band');
const made = [];
if (!B.fan) {
  const w = PAD * 2 + B.steps.length * FW + (B.steps.length - 1) * GAP;
  const TOP_D = TOP + FH + 180;
  text(sec, B.key + ' · ' + B.title, 28, true, null, PAD, 46, Math.max(600, w - 240), TX.title + ' · ' + B.key);
  if (B.note) text(sec, B.note, 14, false, MUTED, PAD, 92, Math.max(600, w - 240), TX.note + ' · ' + B.key);
  text(sec, TX.light, 11, true, MUTED, PAD, 144, 200, TX.themeLight);
  if (DARK) text(sec, TX.dark, 11, true, MUTED, PAD, TOP_D - 62, 200, TX.themeDark);
  for (let i = 0; i < B.steps.length; i++) {
    const s = B.steps[i], x = PAD + i * PITCH;
    text(sec, (i + 1) + ' · ' + s.title, 18, true, null, x, 168, FW, TX.label + ' · ' + s.code);
    if (!s.ids) { text(sec, TX.missing.replace('{screen}', s.screen), 16, false, MUTED, x, TOP + 20, FW); continue; }
    made.push((await screen(sec, s.ids, false, x, TOP, 1, s.code + ' · ' + s.title)).id);
    if (s.sub) text(sec, s.sub, 12, false, MUTED, x, TOP + FH + 14, FW, TX.subtitle + ' · ' + s.code);
    if (DARK) made.push((await screen(sec, s.ids, true, x, TOP_D, 1, s.code + ' · ' + s.title + TX.darkSuffix)).id);
    if (i > 0) {
      const x0 = x - GAP + 24, dx = GAP - 48;
      await arrow(sec, x0, TOP + FH / 2, dx, 0, B.key + '·' + i + '→' + (i + 1) + (s.via ? ' · ' + s.via : ''));
      if (DARK) await arrow(sec, x0, TOP_D + FH / 2, dx, 0, B.key + '·' + i + '→' + (i + 1) + TX.darkSuffix);
      if (s.via) { const t = text(sec, s.via, 14, false, MUTED, x0, TOP + FH / 2 - 36 - 20, dx, TX.gesture + ' · ' + B.key + '·' + i + '→' + (i + 1)); t.textAlignHorizontal = 'CENTER'; t.y = TOP + FH / 2 - 16 - t.height; }
    }
  }
  sec.resizeWithoutConstraints(w, (DARK ? TOP_D : TOP) + FH + 120);
} else {
  // fan: the first screen opens the others, stacked to its right
  const kids = B.steps.slice(1), PY = FH + 220;
  const stackH = kids.length * PY - 220;
  const w = PAD * 2 + 2 * FW + GAP;
  const DY = TOP + stackH + 260;
  text(sec, B.key + ' · ' + B.title, 28, true, null, PAD, 46, w - 240, TX.title + ' · ' + B.key);
  if (B.note) text(sec, B.note, 14, false, MUTED, PAD, 92, w - 240, TX.note + ' · ' + B.key);
  for (const [dark, off] of [[false, 0], ...(DARK ? [[true, DY]] : [])]) {
    text(sec, dark ? TX.dark : TX.light, 11, true, MUTED, PAD, off + 144, 200, dark ? TX.themeDark : TX.themeLight);
    const p = B.steps[0], py = off + TOP + (stackH - FH) / 2;
    if (!dark) text(sec, '1 · ' + p.title, 18, true, null, PAD, py - 42, FW, TX.label + ' · ' + p.code);
    if (p.ids) made.push((await screen(sec, p.ids, dark, PAD, py, 1, p.code + ' · ' + p.title + (dark ? TX.darkSuffix : ''))).id);
    for (let i = 0; i < kids.length; i++) {
      const s = kids[i], x = PAD + FW + GAP, y = off + TOP + i * PY;
      if (!dark) text(sec, (i + 2) + ' · ' + s.title, 18, true, null, x, y - 42, FW, TX.label + ' · ' + s.code);
      if (s.ids) made.push((await screen(sec, s.ids, dark, x, y, 1, s.code + ' · ' + s.title + (dark ? TX.darkSuffix : ''))).id);
      await arrow(sec, PAD + FW + 24, py + FH / 2, GAP - 48, (y + FH / 2) - (py + FH / 2), B.key + '·1→' + (i + 2) + (s.via ? ' · ' + s.via : '') + (dark ? TX.darkSuffix : ''));
      if (!dark && s.via) text(sec, s.via, 14, false, MUTED, x, y + FH + 12, FW, TX.gesture + ' · ' + B.key + '·1→' + (i + 2));
    }
  }
  sec.resizeWithoutConstraints(w, (DARK ? DY : 0) + TOP + stackH + 160);
}
page.flowStartingPoints = [];
return { band: sec.id, copies: made.length, missing: B.missing };
`;
  writeFileSync(path.join(outDir, `${String(n).padStart(2, '0')}-${flow.key}.figma.js`), code);
}

// ——— compact map: one tree per app ———
if (compact.length) {
  const CW = W / 2, CH = H / 2, CPAD = 120, CTOP = 200, CPY = CH + 120;
  const blocks = compact.map((b) => ({ title: b.title, hue: b.hue || null, note: b.note || '',
    root: { title: titleOf(b.root), ids: S[b.root] || null }, children: b.children.map((c) => ({ title: titleOf(c), ids: S[c] || null })) }));
  const code = `// generated by gen-flowmap.mjs — compact map (one tree per app), right of the widest band
${COMMON}
const BLOCKS = ${JSON.stringify(blocks)};
const CW = ${CW}, CH = ${CH}, CPAD = ${CPAD}, CTOP = ${CTOP}, CPY = ${CPY};
for (const c of page.children.filter((c) => c.getSharedPluginData('uic', 'map') === 'compact')) c.remove();
const bands = page.children.filter((c) => c.getSharedPluginData('uic', 'map') === 'band');
const X = Math.max(...bands.map((b) => b.x + b.width)) + 1500;
let y = 0;
const out = [];
for (const b of BLOCKS) {
  const colW = CPAD + CW + 400 + CW + CPAD;
  const treeH = Math.max(CH, b.children.length * CPY - 120);
  const sec = section(); page.appendChild(sec);
  sec.name = TX.compact + ' · ' + b.title; sec.x = X; sec.y = y; sec.setSharedPluginData('uic', 'map', 'compact');
  if (b.hue) { const r = figma.createRectangle(); sec.appendChild(r); r.resize(16, 56); r.x = CPAD; r.y = 44; r.fills = [{ type: 'SOLID', color: hex(b.hue) }]; r.name = TX.colorTab; }
  text(sec, b.title, 40, true, null, CPAD + 32, 40, 2000, 'app');
  if (b.note) text(sec, b.note, 16, false, MUTED, CPAD + 32, 100, 2 * colW - 300, TX.question);
  for (const [dark, ox] of [[false, 0], ...(DARK ? [[true, colW + 200]] : [])]) {
    text(sec, dark ? TX.dark : TX.light, 11, true, MUTED, ox + CPAD, CTOP - 40, 200);
    const ry = CTOP + (treeH - CH) / 2;
    if (b.root.ids) await screen(sec, b.root.ids, dark, ox + CPAD, ry, 0.5, b.title + ' · ' + TX.root + (dark ? TX.darkSuffix : ''));
    if (!dark) text(sec, b.root.title, 14, true, null, ox + CPAD, ry + CH + 10, CW);
    const SP = ox + CPAD + CW + 200;
    await arrow(sec, ox + CPAD + CW, ry + CH / 2, 200, 0, TX.trunk, false);
    if (b.children.length > 1) {
      const a = CTOP + CH / 2, z = CTOP + (b.children.length - 1) * CPY + CH / 2;
      await arrow(sec, SP, a, 0, z - a, TX.spine, false);
    }
    for (let i = 0; i < b.children.length; i++) {
      const c = b.children[i], cy = CTOP + i * CPY;
      await arrow(sec, SP, cy + CH / 2, 180, 0, '→ ' + c.title);
      if (c.ids) await screen(sec, c.ids, dark, SP + 200, cy, 0.5, b.title + ' · ' + c.title + (dark ? TX.darkSuffix : ''));
      if (!dark) text(sec, c.title, 14, true, null, SP + 200, cy + CH + 10, CW);
    }
  }
  sec.resizeWithoutConstraints(DARK ? 2 * colW + 200 : colW, CTOP + treeH + 160);
  y += sec.height + 300;
  out.push(sec.id);
}
// index: link each entry to its band
const secs = Object.fromEntries(page.children.filter((c) => c.getSharedPluginData('uic', 'map') === 'band').map((c) => [c.name.split(' · ')[0], c.id]));
const head = page.children.find((c) => c.getSharedPluginData('uic', 'map') === 'head');
let linked = 0;
if (head) for (const t of head.findAll((n) => n.type === 'TEXT' && n.getSharedPluginData('uic', 'indexOf'))) {
  const id = secs[t.getSharedPluginData('uic', 'indexOf')];
  if (id) { t.setRangeHyperlink(0, t.characters.length, { type: 'NODE', value: id }); linked++; }
}
page.flowStartingPoints = [];
return { compact: out, linked };
`;
  writeFileSync(path.join(outDir, '99-compact.figma.js'), code);
}
console.log(JSON.stringify({ bands: n, compact: compact.length, out: outDir }));
