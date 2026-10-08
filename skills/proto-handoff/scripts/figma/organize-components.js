// use_figma script template — lays out the Components page by stage: one SECTION per
// stage, side by side in one row and top-aligned (the house layout, see page-style in SKILL.md),
// one card per component (name, kind, variant count, uses, description) holding the component
// or component set, and every set's variants re-flowed into a grid instead of one endless row.
// Moving a main component keeps every instance linked; nothing is recreated.
// Re-runnable: cards and sections are found by uic.card / uic.category and reused.
const PARAMS = /*PARAMS*/ { page: '', collection: 'Tokens', categories: [], uses: {}, notes: {}, rowWidth: 3200, setWidth: 2400,
  style: { pageBg: '#cacaca', sectionFill: '#bdbdbd', title: '#1a1c1f', subtle: '#3d3f42', gap: 200 } } /*END*/;
// categories: [{ name, desc, items: [componentName | 'frame:<name>'] }] — in board order
// text: the card texts in the docs language (lib/labels.mjs organize); English by default

const page = await figma.getNodeByIdAsync(PARAMS.page);
await figma.setCurrentPageAsync(page);
const F = { r: { family: 'Inter', style: 'Regular' }, m: { family: 'Inter', style: 'Medium' }, b: { family: 'Inter', style: 'Semi Bold' } };
for (const f of Object.values(F)) await figma.loadFontAsync(f);
const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === PARAMS.collection);
const vars = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === col.id);
// the base color of a bound paint is what screenshots and thumbnails show: it is the variable's
// first-mode value (aliases followed), never a placeholder black
const resolved = {};
for (const v of vars.filter((x) => x.resolvedType === 'COLOR')) {
  let val = v.valuesByMode[col.modes[0].modeId], hops = 0;
  while (val && val.type === 'VARIABLE_ALIAS' && hops++ < 5) {
    const t = await figma.variables.getVariableByIdAsync(val.id);
    const tc = t && (await figma.variables.getVariableCollectionByIdAsync(t.variableCollectionId));
    val = t && tc ? t.valuesByMode[tc.defaultModeId] : null;
  }
  if (val && 'r' in val) resolved[v.name] = { r: val.r, g: val.g, b: val.b };
}
const paint = (n) => { const v = vars.find((x) => x.name === n); return v ? figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: resolved[n] || { r: 0.5, g: 0.5, b: 0.5 } }, 'color', v) : { type: 'SOLID', color: { r: 1, g: 1, b: 1 } }; };
const T = (s, size, w, color) => { const t = figma.createText(); t.fontName = F[w || 'r']; t.fontSize = size; t.characters = String(s); t.fills = [paint(color || 'color/fg')]; return t; };
const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const out = { sections: [], cards: 0, unplaced: [], missing: [] };
const ST = PARAMS.style;
page.backgrounds = [{ type: 'SOLID', color: hex(ST.pageBg) }];
const raw = (h) => [{ type: 'SOLID', color: hex(h) }];
const TXT = Object.assign({
  kind: { atom: 'Atom', component: 'Component', list: 'List · slot Rows', container: 'Container · slot Content' },
  anatomy: 'Anatomy', more: '… {n} more', instanceTag: ' (component)', textTag: ' (text)',
  specs: 'Specs', fixedPositions: 'Fixed positions (no auto layout)', textProp: 'text', radius: 'Radius', mixed: 'mixed',
  tokens: 'Tokens', color: 'Color', text: 'Text', space: 'Space',
  raw: 'No token: {fills} fills, {texts} texts', noRaw: 'No raw values',
  componentOne: 'component', componentMany: 'components', icons: '{n} icons', variantOne: 'variant', variantMany: 'variants',
  uses: '{n} uses on the screens', unused: 'not used on any screen',
}, PARAMS.text || {});
const fmt = (s, o) => String(s).replace(/\{(\w+)\}/g, (m, k) => (o[k] === undefined ? m : o[k]));
const KIND = TXT.kind;

// every main component / set anywhere on the page (inside old cards too), and loose frames
const all = page.findAll((n) => n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && n.parent.type !== 'COMPONENT_SET'));
const byName = new Map(all.filter((n) => !n.name.startsWith('Icon/')).map((n) => [n.name, n]));   // icons live on their board
const frames = new Map(page.findAll((n) => n.type === 'FRAME' && !n.getSharedPluginData('uic', 'card')).map((n) => [n.name, n]));

// variants of a set in a grid: rows of props, wrapped at setWidth
function regrid(set) {
  if (set.layoutMode && set.layoutMode !== 'NONE') set.layoutMode = 'NONE';   // a wrap auto layout would undo the grid
  const kids = [...set.children].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const gap = 24, pad = 24;
  let x = pad, y = pad, rowH = 0, maxX = 0;
  for (const k of kids) {
    if (x > pad && x + k.width > PARAMS.setWidth) { x = pad; y += rowH + gap; rowH = 0; }
    k.x = x; k.y = y; x += k.width + gap; rowH = Math.max(rowH, k.height); maxX = Math.max(maxX, x);
  }
  set.resizeWithoutConstraints(Math.max(maxX - gap + pad, 40), y + rowH + pad);
}

// anatomy, specs and applied tokens of a component, read from its (first) main
const varName = async (id) => { try { const v = await figma.variables.getVariableByIdAsync(id); return v ? v.name : null; } catch (e) { return null; } };
async function specOf(node) {
  const main = node.type === 'COMPONENT_SET' ? node.defaultVariant || node.children[0] : node;
  const px = (v) => Math.round(v * 10) / 10;
  const colors = new Set(), texts = new Set(), spaces = new Set(), radii = new Set(), raw = { fill: 0, text: 0 };
  for (const n of [main, ...main.findAll(() => true)]) {
    const bv = n.boundVariables || {};
    for (const k of ['fills', 'strokes']) for (const a of [].concat(bv[k] || [])) { const nm = a && (await varName(a.id)); if (nm) colors.add(nm.replace('color/', '')); }
    for (const k of ['paddingLeft', 'paddingTop', 'itemSpacing', 'counterAxisSpacing']) if (bv[k]) { const nm = await varName(bv[k].id); if (nm) spaces.add(nm); }
    if (bv.topLeftRadius) { const nm = await varName(bv.topLeftRadius.id); if (nm) radii.add(nm); }
    if (n.type === 'TEXT') {
      if (n.textStyleId && n.textStyleId !== figma.mixed) { const st = await figma.getStyleByIdAsync(n.textStyleId); if (st) texts.add(st.name); } else raw.text++;
    }
    if ('fills' in n && n.fills !== figma.mixed) for (const p of n.fills) if (p.type === 'SOLID' && p.visible !== false && !(p.boundVariables || {}).color) raw.fill++;
  }
  const lay = main.layoutMode && main.layoutMode !== 'NONE'
    ? `${main.layoutMode === 'HORIZONTAL' ? 'Horizontal' : main.layoutMode === 'VERTICAL' ? 'Vertical' : 'Grid'} · gap ${px(main.itemSpacing || 0)} · padding ${[main.paddingTop, main.paddingRight, main.paddingBottom, main.paddingLeft].map(px).join('/')}`
    : TXT.fixedPositions;
  const props = Object.entries(node.componentPropertyDefinitions || {}).map(([k, d]) => `${k.split('#')[0]} (${d.type === 'VARIANT' ? d.variantOptions.slice(0, 6).join(' / ') + (d.variantOptions.length > 6 ? ' …' : '') : d.type === 'TEXT' ? TXT.textProp : d.type.toLowerCase()})`);
  const anatomy = ('children' in main ? main.children : []).map((c, i) => `${i + 1}. ${c.name}${c.type === 'INSTANCE' ? TXT.instanceTag : c.type === 'TEXT' ? TXT.textTag : ''}`);
  const colBox = (head, lines, w) => {
    const b = figma.createAutoLayout('VERTICAL', { name: head, itemSpacing: 4 }); b.fills = [];
    b.appendChild(T(head, 12, 'm', 'color/muted'));
    for (const l of (lines.length ? lines : ['—'])) { const t = T(l, 12); t.textAutoResize = 'HEIGHT'; t.resize(w, t.height); b.appendChild(t); }
    return b;
  };
  const box = figma.createAutoLayout('HORIZONTAL', { name: 'specs', itemSpacing: 32 }); box.fills = [];
  box.paddingTop = 16; box.strokes = [paint('color/border')]; box.strokeWeight = 0; box.strokeTopWeight = 1;
  box.appendChild(colBox(TXT.anatomy, anatomy.slice(0, 12).concat(anatomy.length > 12 ? [fmt(TXT.more, { n: anatomy.length - 12 })] : []), 220));
  box.appendChild(colBox(TXT.specs, [`${px(main.width)} × ${px(main.height)} px`, lay, `${TXT.radius} ${main.cornerRadius === figma.mixed ? TXT.mixed : px(main.cornerRadius || 0)}${radii.size ? ' · ' + [...radii].join(', ') : ''}`, ...props.slice(0, 8)], 260));
  box.appendChild(colBox(TXT.tokens, [
    TXT.color + ': ' + (colors.size ? [...colors].slice(0, 10).join(', ') : '—'),
    TXT.text + ': ' + (texts.size ? [...texts].slice(0, 6).join(', ') : '—'),
    TXT.space + ': ' + (spaces.size ? [...spaces].join(', ') : '—'),
    raw.fill + raw.text ? fmt(TXT.raw, { fills: raw.fill, texts: raw.text }) : TXT.noRaw,
  ], 300));
  box.setSharedPluginData('uic', 'specs', '1');
  return box;
}

const placed = new Set();
let sx = 0;
for (const cat of PARAMS.categories) {
  let sec = page.children.find((n) => n.type === 'SECTION' && n.getSharedPluginData('uic', 'category') === cat.name);
  if (!sec) { sec = figma.createSection(); page.appendChild(sec); sec.setSharedPluginData('uic', 'category', cat.name); }
  sec.name = cat.name;
  sec.fills = raw(ST.sectionFill);
  let x = 80, y = 200, rowH = 0, maxX = 0;
  // section header: category name and what it holds
  let head = sec.children.find((n) => n.getSharedPluginData('uic', 'catHead'));
  if (head) head.remove();
  head = figma.createAutoLayout('VERTICAL', { name: 'header', itemSpacing: 6 }); head.fills = [];
  // text straight on the section's gray: fixed dark inks, AA on the fill (not theme tokens)
  const h1 = T(cat.name, 40, 'b'); h1.fills = raw(ST.title); head.appendChild(h1);
  const present = cat.items.filter((i) => (i.startsWith('frame:') ? frames.get(i.slice(6)) : byName.get(i)));
  const sub = T(`${present.length} ${present.length === 1 ? TXT.componentOne : TXT.componentMany}${cat.desc ? ' · ' + cat.desc : ''}`, 16, 'r');
  sub.fills = raw(ST.subtle); head.appendChild(sub);
  sec.appendChild(head); head.x = 80; head.y = 60; head.setSharedPluginData('uic', 'catHead', '1');
  for (const item of cat.items) {
    const isFrame = item.startsWith('frame:');
    const node = isFrame ? frames.get(item.slice(6)) : byName.get(item);
    if (!node) { out.missing.push(item); continue; }
    placed.add(node.id);
    let card = node.parent && node.parent.getSharedPluginData && node.parent.getSharedPluginData('uic', 'card') ? node.parent : null;
    if (card) { for (const c of [...card.children]) if (c !== node) c.remove(); }
    else {
      card = figma.createAutoLayout('VERTICAL', { name: 'card' });
      card.setSharedPluginData('uic', 'card', item);
    }
    card.name = `Card · ${node.name}`;
    card.itemSpacing = 16; card.paddingLeft = card.paddingRight = card.paddingTop = card.paddingBottom = 32;
    card.fills = [paint('color/bg')]; card.cornerRadius = 0;
    card.strokes = [paint('color/border')]; card.strokeWeight = 1;
    card.clipsContent = false;
    const n = node.type === 'COMPONENT_SET' ? node.children.length : 1;
    if (node.type === 'COMPONENT_SET') regrid(node);
    const title = figma.createAutoLayout('VERTICAL', { name: 'title', itemSpacing: 4 }); title.fills = [];
    title.appendChild(T(node.name, 24, 'b'));
    const meta = [isFrame ? fmt(TXT.icons, { n: node.children.length }) : `${n} ${n === 1 ? TXT.variantOne : TXT.variantMany}`];
    const kind = !isFrame && node.getSharedPluginData('uic', 'kind');
    if (kind && KIND[kind]) meta.unshift(KIND[kind]);
    const u = PARAMS.uses[node.name];
    if (u) meta.push(typeof u === 'string' ? u : fmt(TXT.uses, { n: u }));
    else if (!isFrame) meta.push(TXT.unused);
    title.appendChild(T(meta.join(' · '), 13, 'r', 'color/muted'));
    const note = (PARAMS.notes[node.name] || (node.type !== 'FRAME' && node.description) || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    if (note) { const d = T(note, 13, 'r', 'color/muted'); d.textAutoResize = 'HEIGHT'; d.resize(Math.max(320, Math.min(node.width, 720)), d.height); title.appendChild(d); }
    card.insertChild(0, title);
    // a main made from a stretched screen node keeps layoutAlign STRETCH: inside the vertical card
    // it would fill the card and every instance that follows the main's width would grow with it
    const keep = [node.width, node.height, node.primaryAxisSizingMode, node.counterAxisSizingMode];
    card.appendChild(node);
    if (node.layoutAlign === 'STRETCH' || node.layoutGrow) { node.layoutAlign = 'INHERIT'; node.layoutGrow = 0; }
    if (Math.abs(node.width - keep[0]) > 0.01 || Math.abs(node.height - keep[1]) > 0.01) {
      node.resize(keep[0], keep[1]);
      if (node.layoutMode && node.layoutMode !== 'NONE') { node.primaryAxisSizingMode = keep[2]; node.counterAxisSizingMode = keep[3]; }
    }
    if (!isFrame) card.appendChild(await specOf(node));
    sec.appendChild(card);
    if (x > 80 && x + card.width > PARAMS.rowWidth) { x = 80; y += rowH + 64; rowH = 0; }
    card.x = x; card.y = y; x += card.width + 64; rowH = Math.max(rowH, card.height); maxX = Math.max(maxX, x);
    out.cards++;
  }
  sec.resizeWithoutConstraints(Math.max(maxX + 16, head.width + 160), y + rowH + 80);
  // one row of sections, top-aligned, in board order
  sec.x = sx; sec.y = 0; sx += sec.width + ST.gap;
  out.sections.push(`${cat.name}: ${present.length}`);
}
// anything left outside the categories: listed, never deleted
for (const n of all) if (!placed.has(n.id) && !n.name.startsWith('Icon/')) out.unplaced.push(n.name);
// drop empty old cards and sections
for (const s of page.children.filter((n) => n.type === 'SECTION' && !PARAMS.categories.some((c) => c.name === n.name) && n.children.length === 0)) s.remove();
return out;
