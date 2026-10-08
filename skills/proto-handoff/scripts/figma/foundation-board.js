// use_figma script template — renders one Foundations topic (color, type, spacing…) from a
// board spec made by gen-foundations.mjs. One board per mode, side by side, with the Tokens
// collection pinned to that mode, so every swatch, text and bar is bound and follows the file.
// Before rendering it can create the topic's own assets (text styles, spacing variables).
// Boards carry uic.foundation = topic and uic.order: a re-run replaces only this topic's boards
// and re-flows the page in the house layout: one gray SECTION per topic (title, description,
// its boards side by side, light then dark), the sections in one row, top-aligned, in order.
const PARAMS = /*PARAMS*/ { page: '', collection: 'Tokens', topic: '', order: 0, modes: ['Light'], blocks: [], textStyles: [], spaceVars: [], legacy: [], tones: {}, effectStyles: [], gridStyles: [], componentsPage: '' } /*END*/;

const F = { r: { family: 'Inter', style: 'Regular' }, m: { family: 'Inter', style: 'Medium' }, b: { family: 'Inter', style: 'Semi Bold' } };
// texts in the docs language (gen-foundations.mjs passes them from lib/labels.mjs); English by default
const TXT = Object.assign({ pairSample: 'Aa Text', specimen: 'Quarterly report 2026', descModes: "Light and dark mode, bound to the file's variables", descSingle: "Bound to the file's variables" }, PARAMS.text || {});
const page = await figma.getNodeByIdAsync(PARAMS.page);
await figma.setCurrentPageAsync(page);
// the house style of every documentation page (Components, Foundations, Screens, User flows)
const ST = PARAMS.style || { pageBg: '#cacaca', sectionFill: '#bdbdbd', title: '#1a1c1f', subtle: '#3d3f42', gap: 200 };
const hexc = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
page.backgrounds = [{ type: 'SOLID', color: hexc(ST.pageBg) }];
for (const f of Object.values(F)) await figma.loadFontAsync(f);
const out = { topic: PARAMS.topic, boards: [], styles: { created: 0, updated: 0 }, vars: { created: 0, updated: 0 }, missing: [], findings: [] };

const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === PARAMS.collection);
let vars = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === col.id);

// --- topic assets ---------------------------------------------------------------------------
for (const s of [...PARAMS.spaceVars, ...(PARAMS.floatVars || [])]) {
  let v = vars.find((x) => x.name === s.name);
  if (!v) { v = figma.variables.createVariable(s.name, col, 'FLOAT'); vars.push(v); out.vars.created++; } else out.vars.updated++;
  for (const m of col.modes) v.setValueForMode(m.modeId, s.value);
  v.scopes = s.scopes; v.description = s.description;
  if (s.code) v.setVariableCodeSyntax('WEB', s.code);
}
const Vany = (name) => vars.find((x) => x.name === name);
const effs = await figma.getLocalEffectStylesAsync();
for (const e of PARAMS.effectStyles || []) {
  let st = effs.find((x) => x.name === e.name);
  if (!st) { st = figma.createEffectStyle(); st.name = e.name; effs.push(st); out.styles.created++; } else out.styles.updated++;
  // shadow color stays bound to its token, so the same style is right in light and dark
  st.effects = e.effects.map((x) => {
    let f = { type: x.type, color: { r: 0, g: 0, b: 0, a: x.a ?? 0.15 }, offset: { x: 0, y: x.y || 0 }, radius: x.blur || 0, spread: x.spread || 0, visible: true, blendMode: 'NORMAL' };
    if (x.type === 'DROP_SHADOW') f.showShadowBehindNode = false;
    const v = x.v && Vany(x.v);
    if (v) f = figma.variables.setBoundVariableForEffect(f, 'color', v); else if (x.v) out.missing.push(x.v);
    return f;
  });
  st.description = e.description || '';
}
const grids = await figma.getLocalGridStylesAsync();
for (const g of PARAMS.gridStyles || []) {
  let st = grids.find((x) => x.name === g.name);
  if (!st) { st = figma.createGridStyle(); st.name = g.name; grids.push(st); out.styles.created++; } else out.styles.updated++;
  st.layoutGrids = g.grids.map((x) => ({ visible: true, color: { r: 0.85, g: 0.2, b: 0.4, a: 0.1 }, ...x }));
  st.description = g.description || '';
}
const styles = await figma.getLocalTextStylesAsync();
for (const s of PARAMS.textStyles) {
  const font = { family: s.family, style: s.style };
  await figma.loadFontAsync(font);
  let st = styles.find((x) => x.name === s.name);
  if (!st) { st = figma.createTextStyle(); st.name = s.name; styles.push(st); out.styles.created++; } else out.styles.updated++;
  st.fontName = font; st.fontSize = s.size;
  st.lineHeight = s.lh === 'auto' ? { unit: 'AUTO' } : { unit: 'PIXELS', value: s.lh };
  st.letterSpacing = { unit: 'PIXELS', value: s.ls };
  st.textCase = s.textCase || 'ORIGINAL';
  st.description = s.description;
}

// --- helpers --------------------------------------------------------------------------------
const V = (name) => { const v = vars.find((x) => x.name === name); if (!v) out.missing.push(name); return v; };
const paint = (name) => { const v = V(name); return v ? figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }, 'color', v) : { type: 'SOLID', color: { r: 1, g: 0, b: 1 } }; };
const T = (chars, o = {}) => {
  const t = figma.createText();
  t.fontName = o.w === 'b' ? F.b : o.w === 'm' ? F.m : F.r;
  t.fontSize = o.size || 13; t.lineHeight = { unit: 'PERCENT', value: 145 };
  t.characters = String(chars == null ? '' : chars);
  t.fills = [paint(o.color || 'color/fg')];
  if (o.width) { t.textAutoResize = 'HEIGHT'; t.resize(o.width, t.height); }
  return t;
};
const stack = (dir, name, gap, o = {}) => {
  const f = figma.createAutoLayout(dir, { name, itemSpacing: gap });
  f.fills = o.fill ? [paint(o.fill)] : [];
  f.clipsContent = false; // shadows and rings drawn outside a card must stay visible
  if (o.pad != null) f.paddingLeft = f.paddingRight = f.paddingTop = f.paddingBottom = o.pad;
  return f;
};
const sw = (name, w, h) => {
  const r = figma.createRectangle();
  r.name = name; r.resize(w, h); r.cornerRadius = 6;
  r.fills = [paint(name)]; r.strokes = [paint('color/border')]; r.strokeWeight = 1;
  return r;
};
const CONTENT = 1136;
const styleByName = Object.fromEntries(styles.map((s) => [s.name, s]));

// a cell is text, or a small object: {m:{Light,Dark}} per-mode text, {sw} swatch, {pair:[fg,bg]}
// sample on its background, {style,text} specimen in a text style, {bar} spacing bar, {badge}
async function cell(c, w, mode, head) {
  if (c == null || typeof c !== 'object') return T(c, { width: w, size: head ? 11 : 12.5, w: head ? 'm' : null, color: head ? 'color/muted' : 'color/fg' });
  if (c.m) return cell(c.m[mode] ?? '', w, mode);
  if (c.badge) {
    // a badge is a level name; its colors come from PARAMS.tones (one entry per level)
    const lv = c.badge[mode] ?? c.badge;
    const b = typeof lv === 'string' ? { text: lv, ...(PARAMS.tones || {})[lv] } : lv;
    const box = stack('HORIZONTAL', 'badge', 0, { fill: b.bg });
    box.paddingLeft = box.paddingRight = 8; box.paddingTop = box.paddingBottom = 2; box.cornerRadius = 999;
    box.appendChild(T(b.text, { size: 11, w: 'm', color: b.fg }));
    return box;
  }
  if (c.sw) { const r = stack('HORIZONTAL', 'swatch', 8); r.counterAxisAlignItems = 'CENTER'; r.appendChild(sw(c.sw, 20, 20)); r.appendChild(T(c.label || c.sw.replace('color/', ''), { size: 12 })); return r; }
  if (c.pair) {
    const box = stack('HORIZONTAL', 'sample', 0, { fill: c.pair[1] });
    box.paddingLeft = box.paddingRight = 12; box.paddingTop = box.paddingBottom = 6; box.cornerRadius = 6;
    box.strokes = [paint('color/border')]; box.strokeWeight = 1;
    box.appendChild(T(c.text || TXT.pairSample, { size: 13, w: 'm', color: c.pair[0] }));
    return box;
  }
  if (c.style) {
    const t = T(c.text || TXT.specimen, { width: w });
    const st = styleByName[c.style];
    if (st) await t.setTextStyleIdAsync(st.id); else out.missing.push(c.style);
    t.fills = [paint('color/fg')];
    return t;
  }
  if (c.bar) {
    const r = figma.createRectangle(); r.name = c.bar;
    r.resize(Math.max(1, c.px), 16); r.fills = [paint('color/done-ink')];
    const v = V(c.bar); if (v) r.setBoundVariable('width', v);
    return r;
  }
  return T(JSON.stringify(c), { width: w });
}

async function block(b, board, mode) {
  let n;
  if (b.k === 'title') {
    n = stack('VERTICAL', 'title', 8);
    n.appendChild(T(b.text, { size: 32, w: 'b' }));
    if (b.sub) n.appendChild(T(b.sub, { size: 14, color: 'color/muted', width: 880 }));
  } else if (b.k === 'h2') {
    n = stack('VERTICAL', b.text, 6);
    n.appendChild(T(b.text, { size: 20, w: 'b' }));
    if (b.sub) n.appendChild(T(b.sub, { size: 13, color: 'color/muted', width: 880 }));
  } else if (b.k === 'p') {
    n = T(b.text, { size: 13, color: b.muted ? 'color/muted' : 'color/fg', width: 880 });
  } else if (b.k === 'swatches') {
    n = stack('HORIZONTAL', 'swatches', 16); n.layoutWrap = 'WRAP'; n.counterAxisSpacing = 20;
    n.resize(CONTENT, n.height); n.primaryAxisSizingMode = 'FIXED';
    for (const it of b.items) {
      const c = stack('VERTICAL', it.v, 4);
      c.appendChild(sw(it.v, 176, 56));
      c.appendChild(T(it.v.replace('color/', ''), { size: 12, w: 'm' }));
      if (it.note) c.appendChild(T(it.note, { size: 11, color: 'color/muted', width: 176 }));
      n.appendChild(c);
    }
  } else if (b.k === 'diagram') {
    // a horizontal strip of named segments, widths to scale (the app shell, a container…)
    n = stack('VERTICAL', 'diagram', 8);
    const row = stack('HORIZONTAL', 'strip', 0);
    const total = b.segs.reduce((a, x) => a + x.px, 0);
    for (const sg of b.segs) {
      const f = stack('VERTICAL', sg.label, 4, { fill: sg.fill || 'color/fill' });
      f.paddingLeft = f.paddingRight = 10; f.paddingTop = 12;
      f.strokes = [paint('color/border')]; f.strokeWeight = 1;
      f.appendChild(T(sg.label, { size: 12, w: 'm' }));
      f.appendChild(T(sg.note || sg.px + ' px', { size: 11, color: 'color/muted' }));
      row.appendChild(f);
      f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
      f.resize(Math.max(40, Math.round((sg.px / total) * CONTENT)), b.h || 140);
      f.clipsContent = true;
    }
    n.appendChild(row);
    if (b.caption) n.appendChild(T(b.caption, { size: 12, color: 'color/muted', width: 880 }));
  } else if (b.k === 'icons') {
    // every icon component, instanced at one size: the set as a designer browses it
    n = stack('HORIZONTAL', 'icons', 12); n.layoutWrap = 'WRAP'; n.counterAxisSpacing = 12;
    n.resize(CONTENT, n.height); n.primaryAxisSizingMode = 'FIXED';
    const cp = await figma.getNodeByIdAsync(PARAMS.componentsPage);
    await cp.loadAsync();
    const icons = cp.findAllWithCriteria({ types: ['COMPONENT'] }).filter((c) => /^Icon\//.test(c.name)).sort((a, z) => a.name.localeCompare(z.name));
    const unnamed = icons.filter((c) => /glyph-/.test(c.name)).map((c) => c.name);
    if (mode === PARAMS.modes[0]) out.findings.push({ icons: icons.length, unnamed });
    for (const c of icons) {
      const cellF = stack('VERTICAL', c.name, 8, { fill: 'color/surface' });
      cellF.counterAxisAlignItems = 'CENTER'; cellF.paddingTop = cellF.paddingBottom = 14; cellF.cornerRadius = 8;
      cellF.strokes = [paint(/glyph-/.test(c.name) ? 'color/late-ink' : 'color/border')]; cellF.strokeWeight = 1;
      const i = c.createInstance();
      i.rescale(b.size / Math.max(i.width, i.height));
      // a glyph with no paint is a state (the unchecked tick is transparent): show it in fg;
      // an all-white glyph lives on a colored tile: give its cell a mid-gray backdrop
      const vec = i.findAll((x) => x.type === 'VECTOR' || x.type === 'BOOLEAN_OPERATION');
      const paints = vec.flatMap((x) => [...(x.fills === figma.mixed ? [] : x.fills), ...x.strokes]).filter((p) => p.visible !== false);
      if (!paints.length) { for (const x of vec) x.strokes = [paint('color/fg')]; out.findings.push({ transparent: c.name }); }
      else if (paints.every((p) => p.color && p.color.r > 0.95 && p.color.g > 0.95 && p.color.b > 0.95)) cellF.fills = [paint('color/bar-edge')];
      cellF.appendChild(i);
      cellF.appendChild(T(c.name.replace('Icon/', ''), { size: 11, color: /glyph-/.test(c.name) ? 'color/late-ink' : 'color/muted' }));
      n.appendChild(cellF);
      cellF.primaryAxisSizingMode = 'AUTO'; cellF.counterAxisSizingMode = 'FIXED'; cellF.resize(128, cellF.height);
    }
  } else if (b.k === 'elev') {
    n = stack('HORIZONTAL', 'levels', 40); n.paddingTop = n.paddingBottom = 24; n.paddingLeft = 8;
    for (const it of b.items) {
      const c = stack('VERTICAL', it.label, 12);
      if (it.backdrop) { c.fills = [paint(it.backdrop)]; c.paddingLeft = c.paddingRight = c.paddingTop = c.paddingBottom = 16; c.cornerRadius = 12; }
      const card = figma.createFrame(); card.name = it.style || 'flat';
      card.resize(240, 120); card.cornerRadius = 10; card.fills = [paint(it.fill || 'color/lift')];
      if (!it.style) { card.strokes = [paint('color/border')]; card.strokeWeight = 1; }
      const st = it.style && effs.find((x) => x.name === it.style);
      if (st) await card.setEffectStyleIdAsync(st.id); else if (it.style) out.missing.push(it.style);
      c.appendChild(card);
      c.appendChild(T(it.label, { size: 13, w: 'm' }));
      c.appendChild(T(it.note, { size: 11.5, color: 'color/muted', width: 240 }));
      n.appendChild(c);
    }
  } else if (b.k === 'radii') {
    n = stack('HORIZONTAL', 'radii', 24); n.layoutWrap = 'WRAP'; n.counterAxisSpacing = 24;
    n.resize(CONTENT, n.height); n.primaryAxisSizingMode = 'FIXED';
    for (const it of b.items) {
      const c = stack('VERTICAL', it.label, 8);
      const r = figma.createRectangle(); r.resize(it.w || 120, it.h || 72);
      r.fills = [paint('color/fill')]; r.strokes = [paint(it.stroke || 'color/fg')]; r.strokeWeight = it.sw || 1.5;
      const v = it.v && Vany(it.v);
      if (v) for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) r.setBoundVariable(k, v);
      else r.cornerRadius = it.r || 0;
      const wv = it.wv && Vany(it.wv); if (wv) r.setBoundVariable('strokeWeight', wv);
      c.appendChild(r);
      c.appendChild(T(it.label, { size: 12, w: 'm' }));
      if (it.note) c.appendChild(T(it.note, { size: 11, color: 'color/muted', width: 160 }));
      n.appendChild(c);
    }
  } else if (b.k === 'table') {
    n = stack('VERTICAL', 'table', 0);
    const rows = [b.head, ...b.rows];
    // columns shrink together when the spec asks for more than the board's content width
    const k = Math.min(1, (CONTENT - 16 * (b.widths.length - 1)) / b.widths.reduce((a, x) => a + x, 0));
    b.widths = b.widths.map((x) => Math.floor(x * k));
    for (let i = 0; i < rows.length; i++) {
      const r = stack('HORIZONTAL', i ? 'row' : 'head', 16);
      r.counterAxisAlignItems = 'CENTER'; r.paddingTop = r.paddingBottom = i ? 10 : 6;
      r.strokes = [paint('color/border')]; r.strokeWeight = 0; r.strokeBottomWeight = 1;
      for (let j = 0; j < b.widths.length; j++) {
        const slot = stack('HORIZONTAL', 'c' + j, 0);
        slot.counterAxisAlignItems = 'CENTER';
        slot.appendChild(await cell(rows[i][j], b.widths[j], mode, i === 0));
        r.appendChild(slot);
        slot.primaryAxisSizingMode = 'FIXED'; slot.resize(b.widths[j], Math.max(1, slot.height));
        slot.counterAxisSizingMode = 'AUTO';
      }
      n.appendChild(r);
    }
  }
  n.setSharedPluginData('uic', 'block', b.req || b.k);
  board.appendChild(n);
}

// --- boards ---------------------------------------------------------------------------------
for (const n of page.findAll((x) => x.getSharedPluginData('uic', 'foundation') === PARAMS.topic || (x.parent === page && PARAMS.legacy.includes(x.name)))) if (!n.removed) n.remove();
// the topic's section: header + boards
let sec = page.children.find((n) => n.type === 'SECTION' && n.getSharedPluginData('uic', 'foundationSection') === PARAMS.topic);
if (!sec) { sec = figma.createSection(); page.appendChild(sec); sec.setSharedPluginData('uic', 'foundationSection', PARAMS.topic); }
sec.name = PARAMS.topic;
sec.fills = [{ type: 'SOLID', color: hexc(ST.sectionFill) }];
sec.setSharedPluginData('uic', 'order', String(PARAMS.order));
for (const c of [...sec.children]) c.remove();
const head = figma.createAutoLayout('VERTICAL', { name: 'header', itemSpacing: 6 }); head.fills = [];
const h1 = figma.createText(); h1.fontName = F.b; h1.fontSize = 40; h1.characters = PARAMS.topic; h1.fills = [{ type: 'SOLID', color: hexc(ST.title) }];
const h2 = figma.createText(); h2.fontName = F.r; h2.fontSize = 16;
h2.characters = PARAMS.desc || (PARAMS.modes.length > 1 ? TXT.descModes : TXT.descSingle);
h2.fills = [{ type: 'SOLID', color: hexc(ST.subtle) }];
head.appendChild(h1); head.appendChild(h2);
sec.appendChild(head); head.x = 80; head.y = 60;
for (const modeName of PARAMS.modes) {
  const mode = col.modes.find((m) => m.name === modeName);
  const board = stack('VERTICAL', `${PARAMS.topic} · ${modeName}`, 40, { fill: 'color/bg', pad: 48 });
  board.paddingBottom = 64;
  sec.appendChild(board);
  board.setExplicitVariableModeForCollection(col, mode.modeId);
  board.setSharedPluginData('uic', 'foundation', PARAMS.topic);
  board.setSharedPluginData('uic', 'order', String(PARAMS.order));
  board.setSharedPluginData('uic', 'mode', modeName);
  for (const b of PARAMS.blocks) await block(b, board, modeName);
  board.counterAxisSizingMode = 'FIXED'; board.resize(CONTENT + 96, board.height);
  out.boards.push(board.id);
}
// boards inside the section: light then dark, side by side under the header
{
  const row = sec.children.filter((n) => n.getSharedPluginData('uic', 'foundation'))
    .sort((a, b) => (a.getSharedPluginData('uic', 'mode') === 'Light' ? -1 : 1) - (b.getSharedPluginData('uic', 'mode') === 'Light' ? -1 : 1));
  let x = 80;
  for (const n of row) { n.x = x; n.y = 200; x += n.width + 64; }
  const h = Math.max(...row.map((n) => n.height), 0);
  sec.resizeWithoutConstraints(Math.max(x - 64 + 80, head.width + 160), 200 + h + 80);
}
// re-flow: the topic sections in one row by order, top-aligned (boards left outside a section by
// an older version are moved into theirs)
const secs = page.children.filter((n) => n.type === 'SECTION' && n.getSharedPluginData('uic', 'foundationSection'))
  .sort((a, b) => +a.getSharedPluginData('uic', 'order') - +b.getSharedPluginData('uic', 'order'));
let sx = 0;
for (const s2 of secs) { s2.x = sx; s2.y = 0; sx += s2.width + ST.gap; }
out.section = sec.id;
out.missing = [...new Set(out.missing)];
return out;
