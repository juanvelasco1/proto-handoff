// use_figma script template — binds the raw values the capture left inside the component mains
// to the design system, so a token edit reaches every instance on every screen:
//   text          → the local text style with the same family, weight, size, line height,
//                   tracking and case (fills stay as they are: color is a variable already)
//   corner radius → radius/* when the value equals one of them
//   padding, gap  → space/* when the value equals one of them
//   stroke weight → border/* when the value equals one of them
//   solid fills and strokes still unbound → reported, never guessed (two tokens share #fff)
// Only mains are bound; instances inherit — except where an instance carried its own value (a
// section padded 17 on this screen, a list 14 apart where the main has 16): binding the main
// resets those overrides, so each main's instances are read first and put back after, bound to
// the variable of their own value when there is one. Safe to re-run.
const PARAMS = /*PARAMS*/ { page: '', collection: 'Tokens', only: null } /*END*/;

const page = await figma.getNodeByIdAsync(PARAMS.page);
await figma.setCurrentPageAsync(page);
const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === PARAMS.collection);
const vars = (await figma.variables.getLocalVariablesAsync()).filter((v) => v.variableCollectionId === col.id);
const m0 = col.modes[0].modeId;
const floatBy = (prefix) => {
  const m = new Map();
  for (const v of vars.filter((x) => x.resolvedType === 'FLOAT' && x.name.startsWith(prefix))) {
    const val = v.valuesByMode[m0];
    if (typeof val === 'number' && !m.has(val)) m.set(val, v);
  }
  return m;
};
const RADIUS = floatBy('radius/'), SPACE = floatBy('space/'), BORDER = floatBy('border/');
const styles = await figma.getLocalTextStylesAsync();
const r1 = (v) => Math.round(v * 10) / 10;
const lhPx = (lh, size) => (lh.unit === 'PIXELS' ? r1(lh.value) : lh.unit === 'PERCENT' ? r1((size * lh.value) / 100) : 'auto');
const lsPx = (ls, size) => r1(ls.unit === 'PIXELS' ? ls.value : (size * ls.value) / 100);
const styleKey = (f, size, lh, ls, tc) => [f.family, f.style, r1(size), lh, ls, tc].join('|');
const styleBy = new Map(styles.map((s) => [styleKey(s.fontName, s.fontSize, lhPx(s.lineHeight, s.fontSize), lsPx(s.letterSpacing, s.fontSize), s.textCase), s]));

const mains = page.findAll((n) => n.type === 'COMPONENT' && (!PARAMS.only || PARAMS.only.includes(n.parent.type === 'COMPONENT_SET' ? n.parent.name : n.name)));
const out = { mains: mains.length, text: 0, textMixed: 0, textNoStyle: {}, radius: 0, space: 0, border: 0, rawFills: 0, rawStrokes: 0, perComponent: {} };
const bump = (ui, k) => { const o = (out.perComponent[ui] = out.perComponent[ui] || {}); o[k] = (o[k] || 0) + 1; };
const KEEP = ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing',
  'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius', 'strokeWeight'];
const poolOf = (k) => (/Radius$/.test(k) ? RADIUS : k === 'strokeWeight' ? BORDER : SPACE);
out.kept = 0;
for (const main of mains) {
  const ui = main.parent.type === 'COMPONENT_SET' ? main.parent.name : main.name;
  // the main's own layers (nested components own their values)
  const own = [main, ...main.findAll(() => true)].filter((n) => {
    if (n.type === 'INSTANCE' || (n.parent && n.parent.type === 'INSTANCE')) return false;
    for (let p = n.parent; p && p !== main; p = p.parent) if (p.type === 'INSTANCE') return false;
    return true;
  });
  // every instance's own values on those layers, before the main is bound (an instance's layer
  // for the main's layer d is "I<instance id>;<d id>")
  // only when this pass binds something on the main (a re-run over bound mains skips it)
  const bv = (n, k) => (n.boundVariables || {})[k];
  const binds = own.some((n) => n.type !== 'TEXT' && (
    ('cornerRadius' in n && n.cornerRadius !== figma.mixed && n.cornerRadius > 0 && !bv(n, 'topLeftRadius') && RADIUS.get(n.cornerRadius)) ||
    ('layoutMode' in n && n.layoutMode !== 'NONE' && ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing'].some((k) => typeof n[k] === 'number' && n[k] > 0 && !bv(n, k) && SPACE.get(n[k]))) ||
    ('strokes' in n && n.strokes.length && typeof n.strokeWeight === 'number' && !bv(n, 'strokeWeight') && BORDER.get(n.strokeWeight))));
  const kept = [];
  for (const inst of binds ? await main.getInstancesAsync() : []) {
    const base = inst.id.startsWith('I') ? inst.id : 'I' + inst.id;
    const subs = new Map(inst.findAll(() => true).map((x) => [x.id, x]));
    for (const d of own) {
      const sub = d === main ? inst : subs.get(base + ';' + d.id);
      if (!sub) continue;
      for (const k of KEEP) {
        if (!(k in d) || !(k in sub)) continue;
        const a = sub[k], b = d[k];
        if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) > 0.01) kept.push([sub, k, a]);
      }
    }
  }
  for (const n of own) {
    if (n.type === 'TEXT') {
      if (n.textStyleId && n.textStyleId !== figma.mixed && n.textStyleId !== '') continue;
      if (n.fontName === figma.mixed || n.fontSize === figma.mixed || n.lineHeight === figma.mixed || n.letterSpacing === figma.mixed) { out.textMixed++; continue; }
      const k = styleKey(n.fontName, n.fontSize, lhPx(n.lineHeight, n.fontSize), lsPx(n.letterSpacing, n.fontSize), n.textCase === figma.mixed ? 'ORIGINAL' : n.textCase);
      const st = styleBy.get(k);
      if (!st) { out.textNoStyle[k] = (out.textNoStyle[k] || 0) + 1; bump(ui, 'rawText'); continue; }
      const fills = n.fills;
      await figma.loadFontAsync(n.fontName);
      await n.setTextStyleIdAsync(st.id);
      if (fills !== figma.mixed) n.fills = fills;
      out.text++; bump(ui, 'text');
      continue;
    }
    if ('cornerRadius' in n && n.cornerRadius !== figma.mixed && n.cornerRadius > 0 && !(n.boundVariables || {}).topLeftRadius) {
      const v = RADIUS.get(n.cornerRadius);
      if (v) { for (const k of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) n.setBoundVariable(k, v); out.radius++; bump(ui, 'radius'); }
    }
    if ('layoutMode' in n && n.layoutMode !== 'NONE') {
      for (const k of ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'itemSpacing', 'counterAxisSpacing']) {
        if (!(k in n) || typeof n[k] !== 'number' || n[k] <= 0 || (n.boundVariables || {})[k]) continue;
        const v = SPACE.get(n[k]);
        if (v) { try { n.setBoundVariable(k, v); out.space++; bump(ui, 'space'); } catch (e) {} }
      }
    }
    if ('strokes' in n && n.strokes.length && typeof n.strokeWeight === 'number' && !(n.boundVariables || {}).strokeWeight) {
      const v = BORDER.get(n.strokeWeight);
      if (v) { try { n.setBoundVariable('strokeWeight', v); out.border++; bump(ui, 'border'); } catch (e) {} }
    }
    for (const [k, key] of [['fills', 'rawFills'], ['strokes', 'rawStrokes']]) {
      if (!(k in n) || n[k] === figma.mixed) continue;
      for (const p of n[k]) if (p.type === 'SOLID' && p.visible !== false && !(p.boundVariables && p.boundVariables.color)) { out[key]++; bump(ui, key); }
    }
  }
  for (const [sub, k, v] of kept) {
    const vv = poolOf(k).get(v);
    try { if (vv) sub.setBoundVariable(k, vv); else sub[k] = v; out.kept++; } catch (e) { try { sub[k] = v; out.kept++; } catch (e2) {} }
  }
}
out.textNoStyle = Object.entries(out.textNoStyle).sort((a, b) => b[1] - a[1]).slice(0, 15);
return out;
