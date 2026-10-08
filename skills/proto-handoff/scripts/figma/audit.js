// use_figma script template — READ-ONLY audit. Says, with evidence, whether the file is what the
// skill promises. Three scopes (PARAMS.scope):
//   components — every inventory component exists once, on its stage's board, with the kind of
//                properties its kind needs (slot for lists/containers whose content changes);
//                no loose or leftover mains; the page follows the house style
//   screens    — per frame: every component the DOM had is an instance (count per component vs
//                the browser census), no tagged copy left un-swapped, scroll boxes clipped, a dark copy
//                (unless PARAMS.requireDark is false: the project has no dark screens)
//   pages      — house style on every documentation page: canvas and section colors, one row of
//                sections (a column on User flows), section order, AA contrast of text on sections
// The node side (audit.mjs) builds PARAMS from the census and turns the results into a report.
const PARAMS = /*PARAMS*/ { scope: 'components', page: '', expected: [], frames: [], census: {}, pages: {}, order: [],
  style: { pageBg: '#cacaca', sectionFill: '#bdbdbd' } } /*END*/;

const U = (n, k) => n.getSharedPluginData('uic', k);
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const solid = (fills) => (Array.isArray(fills) ? fills.filter((p) => p.type === 'SOLID' && p.visible !== false) : [])[0] || null;
const lum = (c) => { const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const checks = [];
const check = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });

async function pageStyle(page, layout, order) {
  const bg = page.backgrounds && page.backgrounds[0];
  check(`${page.name}: canvas ${PARAMS.style.pageBg}`, bg && bg.type === 'SOLID' && hex(bg.color) === PARAMS.style.pageBg, bg ? hex(bg.color) : 'none');
  const secs = page.children.filter((n) => n.type === 'SECTION');
  const wrong = secs.filter((s) => { const p = solid(s.fills); return !p || hex(p.color) !== PARAMS.style.sectionFill; });
  check(`${page.name}: sections ${PARAMS.style.sectionFill}`, secs.length && !wrong.length, wrong.length ? wrong.slice(0, 8).map((s) => s.name) : `${secs.length} sections`);
  if (layout === 'row') {
    const ys = [...new Set(secs.map((s) => Math.round(s.y)))];
    const sorted = secs.slice().sort((a, b) => a.x - b.x);
    let overlap = 0;
    for (let i = 1; i < sorted.length; i++) if (sorted[i].x < sorted[i - 1].x + sorted[i - 1].width) overlap++;
    check(`${page.name}: one row, top-aligned`, ys.length === 1 && !overlap, { tops: ys.slice(0, 6), overlaps: overlap });
    if (order && order.length) {
      const names = sorted.map((s) => s.name).filter((n) => order.includes(n));
      const want = order.filter((n) => names.includes(n));
      check(`${page.name}: section order`, JSON.stringify(names) === JSON.stringify(want), names);
    }
  } else {
    const xs = [...new Set(secs.map((s) => Math.round(s.x)))];
    check(`${page.name}: sections stacked in a column`, xs.length <= 2, xs.slice(0, 6));
  }
  // contrast of text straight on a section (not inside a frame with its own fill)
  let low = [];
  for (const s of secs) {
    const p = solid(s.fills); if (!p) continue;
    const texts = [];
    const walk = (n) => { for (const c of n.children || []) { if (c.type === 'TEXT') texts.push(c); else if ((c.type === 'FRAME' || c.type === 'GROUP') && !solid(c.fills) && c.type !== 'INSTANCE') walk(c); } };
    walk(s);
    for (const t of texts) {
      const tp = solid(t.fills); if (!tp) continue;
      const r = ratio(tp.color, p.color), big = t.fontSize !== figma.mixed && t.fontSize >= 24;
      if (r < (big ? 3 : 4.5)) low.push(`${s.name} · "${t.characters.slice(0, 30)}" ${r.toFixed(2)}:1`);
    }
  }
  check(`${page.name}: text on sections AA`, !low.length, low.slice(0, 10));
}

// pages load on demand: a page that is not the current one has no children until it is loaded
const loadPage = async (id) => { const p = await figma.getNodeByIdAsync(id); if (p && p.type === 'PAGE') await p.loadAsync(); return p; };

if (PARAMS.scope === 'components') {
  const page = await loadPage(PARAMS.page);
  const all = page.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] });
  const owners = {};
  for (const n of all) {
    if (n.type === 'COMPONENT' && n.parent.type === 'COMPONENT_SET') continue;
    const c = U(n, 'component');
    if (c && !c.startsWith('Icon/')) (owners[c] = owners[c] || []).push(n);
  }
  const sectionOf = (n) => { let p = n.parent; while (p && p.type !== 'SECTION' && p.type !== 'PAGE') p = p.parent; return p && p.type === 'SECTION' ? p.name : null; };
  const rows = [];
  for (const e of PARAMS.expected) {
    const list = owners[e.ui] || [];
    const o = list[0];
    const defs = o ? (o.type === 'COMPONENT_SET' || o.parent.type !== 'COMPONENT_SET' ? o.componentPropertyDefinitions : {}) : {};
    const types = Object.values(defs || {}).map((d) => d.type);
    const row = { ui: e.ui, kind: e.kind, stage: e.stage, exists: !!o, dup: list.length > 1, board: o ? sectionOf(o) : null,
      variants: o ? (o.type === 'COMPONENT_SET' ? o.children.length : 1) : 0,
      slot: types.includes('SLOT'), booleans: types.filter((t) => t === 'BOOLEAN').length, texts: types.filter((t) => t === 'TEXT').length,
      old: o ? !!U(o, 'old') : false };
    row.ok = row.exists && !row.dup && row.board === e.stage && !row.old;
    rows.push(row);
  }
  check('every inventory component exists', rows.every((r) => r.exists), rows.filter((r) => !r.exists).map((r) => r.ui));
  check('no duplicated components', rows.every((r) => !r.dup), rows.filter((r) => r.dup).map((r) => r.ui));
  check('each on its stage board', rows.every((r) => !r.exists || r.board === r.stage), rows.filter((r) => r.exists && r.board !== r.stage).map((r) => `${r.ui}: ${r.board} ≠ ${r.stage}`));
  const lists = rows.filter((r) => r.exists && (r.kind === 'list'));
  check('lists keep their rows in a slot', lists.every((r) => r.slot), lists.filter((r) => !r.slot).map((r) => r.ui));
  const known = new Set(PARAMS.expected.map((e) => e.ui));
  const loose = Object.keys(owners).filter((k) => !known.has(k));
  check('no component outside the inventory', !loose.length, loose);
  const leftovers = all.filter((n) => U(n, 'old') || / \(previous\)$/.test(n.name)).map((n) => n.name);
  check('no leftover (previous) components', !leftovers.length, leftovers.slice(0, 20));
  // a main that collapsed (FILL inside its set, a hugging row meeting stretching cards) shows as
  // a sliver: every variant keeps a real size
  const tiny = [];
  for (const o of Object.values(owners).flat()) {
    // a divider is a 1 px line on purpose: collapsed is thinner than what it holds
    const holds = (v) => 'children' in v && v.children.some((c) => c.visible !== false && (c.width > v.width + 2 || c.height > v.height + 2));
    for (const v of o.type === 'COMPONENT_SET' ? o.children : [o]) if ((v.width < 2 || v.height < 2) && (holds(v) || (v.width < 2 && v.height < 2))) tiny.push(`${U(o, 'component')} ${v.name} ${Math.round(v.width)}×${Math.round(v.height)}`);
  }
  check('no collapsed variant (< 2 px)', !tiny.length, tiny.slice(0, 20));
  // a main that stretches or grows inside its showcase card takes the card's width, and so does
  // every instance that follows the main's size
  const stretched = Object.values(owners).flat().filter((o) => o.layoutAlign === 'STRETCH' || o.layoutGrow).map((o) => `${U(o, 'component')} ${Math.round(o.width)}`);
  check('no main stretched by its card', !stretched.length, stretched.slice(0, 20));
  await pageStyle(page, 'row', PARAMS.order);
  return { scope: 'components', checks, rows };
}

if (PARAMS.scope === 'screens') {
  const out = [];
  for (const id of PARAMS.frames) {
    const f = await figma.getNodeByIdAsync(id);
    if (!f) { out.push({ id, missing: true }); continue; }
    const inst = {}, loose = {}, bad = [], scroll = { n: 0, clipped: 0 };
    const walk = (n, hidden) => {
      const h = hidden || n.visible === false;
      const ui = U(n, 'ui');
      if (ui && !h) {
        if (n.type === 'INSTANCE') inst[ui] = (inst[ui] || 0) + 1;
        else if (n.type !== 'COMPONENT') loose[ui] = (loose[ui] || 0) + 1;
      }
      if (/ · (unchanged|no component|slot)$/.test(n.name)) bad.push(n.name);
      if (U(n, 'scroll')) { scroll.n++; if (n.clipsContent && n.overflowDirection !== 'NONE') scroll.clipped++; }
      if ('children' in n) for (const c of n.children) walk(c, h);
    };
    for (const c of f.children) walk(c, false);
    const want = PARAMS.census[id] || {}, slack = (PARAMS.slack || {})[id] || {};
    const diff = {};
    for (const ui of new Set([...Object.keys(want), ...Object.keys(inst), ...Object.keys(slack)])) {
      // a box that paints nothing (a pane handle, a click-catcher) may or may not reach a capture:
      // counted as slack, not as a requirement
      const a = want[ui] || 0, b = inst[ui] || 0, s = slack[ui] || 0;
      if (b < a || b > a + s) diff[ui] = `${b}/${a}${s ? '+' + s : ''}`;
    }
    let dark = false;
    for (const n of f.parent.children) if (U(n, 'darkOf') === id) { dark = true; break; }
    out.push({ id, name: f.name, loose, bad: bad.slice(0, 5), diff, scroll, dark,
      ok: !Object.keys(loose).length && !bad.length && !Object.keys(diff).length && scroll.n === scroll.clipped && (dark || PARAMS.requireDark === false) });
  }
  return { scope: 'screens', frames: out };
}

// the screens on the flow map are copies of the screen frames (uic.flowCopy = the source frame). A
// copy made before a rebuild shows instances of components that no longer exist: empty icons, no
// vectors. Each copy is compared with its source: as many vectors and instances, or the map is stale
async function flowCopies(page) {
  const copies = page.findAll((n) => n.type === 'FRAME' && U(n, 'flowCopy') !== '');
  const count = (f) => ({ v: f.findAllWithCriteria({ types: ['VECTOR', 'BOOLEAN_OPERATION'] }).length, i: f.findAllWithCriteria({ types: ['INSTANCE'] }).length });
  const src = new Map();
  const stale = [];
  let last = Date.now();
  for (const c of copies) {
    if (Date.now() - last > 1500) { await new Promise((r) => setTimeout(r, 0)); last = Date.now(); }
    const sid = U(c, 'flowCopy');
    // the source's page must be loaded: an unloaded page counts only its frames' top layers (0 vectors)
    if (!src.has(sid)) { const s = await figma.getNodeByIdAsync(sid); if (s) { let p = s.parent; while (p && p.type !== 'PAGE') p = p.parent; if (p) await p.loadAsync(); } src.set(sid, s ? count(s) : null); }
    const s = src.get(sid);
    if (!s) { stale.push(`${c.name}: source frame missing`); continue; }
    const k = count(c);
    if (k.v < s.v || k.i !== s.i) stale.push(`${c.name}: ${k.v}/${s.v} vectors, ${k.i}/${s.i} instances`);
  }
  check(`flows: every screen copy matches its screen (${copies.length} copies)`, copies.length > 0 && !stale.length, stale.slice(0, 12));
}
if (PARAMS.scope === 'pages') {
  for (const [key, spec] of Object.entries(PARAMS.pages)) {
    const page = await loadPage(spec.id);
    if (!page) { check(`${key}: page`, false, 'missing'); continue; }
    await pageStyle(page, spec.layout, spec.order);
    if (key === 'flows') await flowCopies(page);
  }
  return { scope: 'pages', checks };
}
return { error: 'unknown scope' };
