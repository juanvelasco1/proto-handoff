// use_figma script template — incremental counterpart of build-components.js. Swaps the tagged
// occurrences of re-captured screens for instances of the components that ALREADY exist, and
// keeps the components in step with the prototype:
//
//   same structure, same layout  → plain swap
//   same structure, new layout   → the main component takes the new layout first, but only
//                                  when every new occurrence agrees on it (a per-instance
//                                  difference such as an avatar's color is not a change of
//                                  the component). Instances everywhere inherit it.
//   new structure (≥ 1 time)     → added to the set as a new shape variant
//   component never seen before  → created as in build-components.js
const PARAMS = /*PARAMS*/ { ui: [], screens: [], componentsPage: '', codeRefs: {}, added: [], lists: {} } /*END*/;

const compPage = await figma.getNodeByIdAsync(PARAMS.componentsPage);
const frames = [];
for (const id of PARAMS.screens) { const f = await figma.getNodeByIdAsync(id); if (f) frames.push(f); }
/*SHAPE*/
const mainSig = (c) => sig(c).replace(/^C/, 'F');
const parseProps = (s) => Object.fromEntries(s.trim().split(/[\s,]+/).filter(Boolean).map((kv) => kv.split('=')));

const LAYOUT_KEYS = ['layoutPositioning', 'layoutAlign', 'layoutGrow', 'gridChildHorizontalAlign', 'gridChildVerticalAlign'];

// a grid child moved into place can leave the empty row/column the auto-flow created
function trimGrid(g) {
  if (!g || g.layoutMode !== 'GRID') return;
  const kids = g.children.filter((c) => c.layoutPositioning !== 'ABSOLUTE');
  if (!kids.length) return;
  try {
    const rows = Math.max(...kids.map((c) => c.gridRowAnchorIndex + c.gridRowSpan));
    const cols = Math.max(...kids.map((c) => c.gridColumnAnchorIndex + c.gridColumnSpan));
    if (g.gridRowCount > rows) g.gridRowCount = rows;
    if (g.gridColumnCount > cols) g.gridColumnCount = cols;
  } catch (e) {}
}
function place(o, inst) {
  // the occurrence leaves first: in a grid it holds its cell, and inserting next to it makes the
  // auto-flow open a new row that stretches the grid (a 30 px button becomes 60 px)
  const parent = o.parent, idx = parent.children.indexOf(o);
  const auto = 'layoutMode' in parent && parent.layoutMode !== 'NONE';
  const keep = {};
  for (const k of LAYOUT_KEYS.concat(['layoutSizingHorizontal', 'layoutSizingVertical', 'x', 'y', 'width', 'height', 'constraints'])) if (k in o) keep[k] = o[k];
  const grid = parent.layoutMode === 'GRID' ? { r: o.gridRowAnchorIndex, c: o.gridColumnAnchorIndex, rs: o.gridRowSpan, cs: o.gridColumnSpan } : null;
  const data = {};
  for (const k of ['link', 'label']) data[k] = o.getSharedPluginData('uic', k);
  o.remove();
  parent.insertChild(Math.min(idx, parent.children.length), inst);
  if (auto) for (const k of LAYOUT_KEYS) if (k in keep && k in inst) { try { inst[k] = keep[k]; } catch (e) {} }
  if (!auto || keep.layoutPositioning === 'ABSOLUTE') { inst.x = keep.x; inst.y = keep.y; }
  if (Math.abs(inst.width - keep.width) > 0.5 || Math.abs(inst.height - keep.height) > 0.5) inst.resize(keep.width, keep.height);
  for (const k of ['layoutSizingHorizontal', 'layoutSizingVertical']) if (auto && k in keep) { try { inst[k] = keep[k]; } catch (e) {} }
  if (keep.constraints) inst.constraints = keep.constraints;
  for (const k in data) if (data[k]) inst.setSharedPluginData('uic', k, data[k]);
  if (grid) {
    try { inst.gridRowSpan = grid.rs; inst.gridColumnSpan = grid.cs; inst.setGridChildPosition(grid.r, grid.c); } catch (e) { gridWarnings++; }
    trimGrid(parent);
  }
}

// Layout properties a component owns. layoutMode goes first: the others depend on it.
const FRAME_PROPS = ['layoutMode', 'layoutWrap', 'itemSpacing', 'counterAxisSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'primaryAxisAlignItems', 'counterAxisAlignItems', 'cornerRadius', 'strokeWeight', 'clipsContent'];
const CHILD_PROPS = ['layoutSizingHorizontal', 'layoutSizingVertical', 'layoutGrow', 'layoutAlign', 'layoutPositioning'];
const TEXT_PROPS = ['textAlignHorizontal', 'textAutoResize', 'fontSize'];
async function syncLayout(main, occs, path, changes) {
  if (main.type !== 'INSTANCE' && 'layoutMode' in main) {
    for (const p of FRAME_PROPS) {
      if (!(p in main)) continue;
      const vals = occs.map((o) => JSON.stringify(o[p]));
      if (vals.some((v) => v !== vals[0]) || vals[0] === JSON.stringify(main[p])) continue;
      if (p === 'layoutMode' && occs[0][p] === 'GRID') return false;   // a grid needs tracks: new shape instead
      try { main[p] = occs[0][p]; changes.push(path + '.' + p + '=' + vals[0]); } catch (e) {}
    }
  }
  if (main.type === 'TEXT') {
    await loadFontsOf(main);
    for (const p of TEXT_PROPS) {
      const vals = occs.map((o) => JSON.stringify(o[p]));
      if (vals.some((v) => v !== vals[0]) || vals[0] === JSON.stringify(main[p]) || occs[0][p] === figma.mixed) continue;
      try { main[p] = occs[0][p]; changes.push(path + '.' + p + '=' + vals[0]); } catch (e) {}
    }
  }
  if (path) for (const p of CHILD_PROPS) {
    if (!(p in main)) continue;
    const vals = occs.map((o) => JSON.stringify(o[p]));
    if (vals.some((v) => v !== vals[0]) || vals[0] === JSON.stringify(main[p])) continue;
    try { main[p] = occs[0][p]; changes.push(path + '.' + p + '=' + vals[0]); } catch (e) {}
  }
  if (main.type !== 'INSTANCE' && 'children' in main) {
    for (let i = 0; i < main.children.length; i++) {
      if (occs.some((o) => !o.children || o.children.length !== main.children.length)) break;
      const ok = await syncLayout(main.children[i], occs.map((o) => o.children[i]), path + '/' + i, changes);
      if (ok === false) return false;
    }
  }
  return true;
}

const owners = {};
// mains can sit anywhere on the page: inside the category sections and cards of organize-components
const mainsOnPage = compPage.findAll((n) => n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && n.parent.type !== 'COMPONENT_SET'));
for (const n of mainsOnPage) { const ui = n.getSharedPluginData('uic', 'component'); if (ui) owners[ui] = n; }
// an untagged component with the same name is the same component: never build a second one
for (const n of mainsOnPage) {
  if ((n.type === 'COMPONENT_SET' || n.type === 'COMPONENT') && PARAMS.ui.includes(n.name) && !owners[n.name]) {
    owners[n.name] = n; n.setSharedPluginData('uic', 'component', n.name);
  }
}
const variantsOf = (owner) => (owner.type === 'COMPONENT_SET' ? [...owner.children] : [owner]);
const propsOf = (v) => { const p = Object.assign({}, v.variantProperties || {}); delete p.shape; return p; };


const MIN_SHAPE = 2;
const frameIds = new Set(PARAMS.screens);
const frameOf = (n) => { let p = n; while (p && !frameIds.has(p.id)) p = p.parent; return p ? p.id : null; };
const modal = (l) => {
  const by = {};
  for (const o of l) { const k = Math.round(o.width) + 'x' + Math.round(o.height); (by[k] = by[k] || []).push(o); }
  return Object.values(by).sort((a, b) => b.length - a.length)[0][0];
};
// a captured box that hugged its content can collapse once it stands alone as a main
const keepSize = (c, [w, h]) => {
  if (Math.abs(c.width - w) <= 0.5 && Math.abs(c.height - h) <= 0.5) return;
  try { if (c.parent.type === 'COMPONENT_SET') { c.layoutSizingHorizontal = 'FIXED'; c.layoutSizingVertical = 'FIXED'; } } catch (e) {}
  if (c.layoutMode === 'HORIZONTAL' || c.layoutMode === 'VERTICAL') { c.primaryAxisSizingMode = 'FIXED'; c.counterAxisSizingMode = 'FIXED'; }
  c.resize(Math.max(w, 0.01), Math.max(h, 0.01));
};
const occ = {};
// an instance carries its main's tag: it (and every layer inside it) is already a component,
// which also makes a batch safe to run twice
const inInstance = (n, root) => { for (let p = n.parent; p && p !== root; p = p.parent) if (p.type === 'INSTANCE') return true; return false; };
for (const f of frames) for (const n of f.findAll((n) => n.type !== 'INSTANCE' && PARAMS.ui.includes(n.getSharedPluginData('uic', 'ui')) && !inInstance(n, f))) { const ui = n.getSharedPluginData('uic', 'ui'); (occ[ui] = occ[ui] || []).push(n); }

// inner components first, whatever order the caller passed: an outer occurrence swapped first
// would carry its parts into the main as plain layers (and remove the occurrences inside it)
const height = {};
for (const f of frames) {
  const walk = (n) => {
    let h = -1;
    if ('children' in n && n.type !== 'INSTANCE') for (const c of n.children) h = Math.max(h, walk(c));
    const ui = n.getSharedPluginData('uic', 'ui');
    if (ui && n.type !== 'INSTANCE') { height[ui] = Math.max(height[ui] || 0, h + 1); return h + 1; }
    return h;
  };
  walk(f);
}
PARAMS.ui = PARAMS.ui.slice().sort((a, b) => (height[a] || 0) - (height[b] || 0));
let cursorY = 0;
for (const c of compPage.children) cursorY = Math.max(cursorY, c.y + c.height + 160);
const report = {};
for (const ui of PARAMS.ui) {
  const list = (occ[ui] || []).filter((o) => !o.removed);
  if (!list.length) continue;
  let owner = owners[ui];
  const r = report[ui] = { occ: list.length, swapped: 0, kept: 0, updated: [], added: 0, created: !owner };
  // group occurrences by (props, structure)
  const groups = {};
  const row = LISTS[ui] || null;
  for (const o of list) { const k = o.getSharedPluginData('uic', 'props') + '|' + shapeKey(o, row); (groups[k] = groups[k] || []).push(o); }
  for (const [key, occs] of Object.entries(groups)) {
    const [propsStr, s] = [key.slice(0, key.lastIndexOf('|')), key.slice(key.lastIndexOf('|') + 1)];
    const want = parseProps(propsStr);
    const sameProps = owner ? variantsOf(owner).filter((v) => (owner.type !== 'COMPONENT_SET' ? !propsStr.trim() : eq(propsOf(v), want))) : [];
    let main = sameProps.find((v) => shapeKey(v, row) === s) || null;
    // a list longer than its main can't hide its way there: it becomes a longer variant
    if (main && row) { const want = Math.max(...occs.map((o) => rowCount(o, row))); if (want > rowCount(main, row) && !(await growList(main, want, row))) main = null; }
    // only screens that already existed can change a main: a screen added to the file brings
    // new occurrences, not a new design of the component
    const edited = occs.filter((o) => !PARAMS.added.includes(frameOf(o)));
    if (main && edited.length && !row) {
      const changes = [];
      const ok = await syncLayout(main, edited, '', changes);
      if (ok !== false && changes.length) r.updated.push(main.name + ': ' + changes.slice(0, 6).join(' '));
      if (ok === false) main = null;
    }
    // a rare extra shape of variants that exist stays as it is; a component or a props value
    // seen for the first time is created even from one occurrence (build-components does the same)
    if (!main && !row && sameProps.length && occs.length < MIN_SHAPE) { r.kept += occs.length; for (const o of occs) if (!o.removed) o.name = ui + ' · not swapped'; continue; }
    if (!main) {
      // a structure the component does not have yet (seen at least twice): add it as a variant
      // (or create the component). The representative has the most common size, and the main
      // keeps that size once it stands alone.
      const rep = row ? occs.slice().sort((a, b) => rowCount(b, row) - rowCount(a, row))[0] : modal(occs);
      const size = [rep.width, rep.height];
      const clone = rep.clone(); compPage.appendChild(clone); clone.x = 0; clone.y = cursorY;
      main = figma.createComponentFromNode(clone);
      if (!owner) {
        main.name = propsStr.trim() ? propsStr.trim().split(/\s+/).join(', ') : ui;
        if (propsStr.trim()) { owner = figma.combineAsVariants([main], compPage); owner.name = ui; } else owner = main;
        owner.description = `Del prototipo: ${PARAMS.codeRefs[ui] || ''}`;
        owner.setSharedPluginData('uic', 'component', ui); owners[ui] = owner;
      } else {
        if (owner.type !== 'COMPONENT_SET') {
          const first = owner; first.name = 'shape=1';
          owner = figma.combineAsVariants([first], compPage); owner.name = ui;
          owner.description = first.description; owner.setSharedPluginData('uic', 'component', ui); owners[ui] = owner;
          first.setSharedPluginData('uic', 'component', '');
        }
        const hasShape = variantsOf(owner).some((v) => v.variantProperties && 'shape' in v.variantProperties);
        const propsName = propsStr.trim() ? propsStr.trim().split(/\s+/).join(', ') : '';
        if (!sameProps.length && propsName) {
          // a props value the set didn't have: its own variant, first of its shapes
          main.name = propsName + (hasShape ? ', shape=1' : '');
        } else {
          if (!hasShape) for (const v of variantsOf(owner)) v.name = v.name + ', shape=1';
          const shapes = (sameProps.length ? sameProps : variantsOf(owner)).map((v) => Number((v.variantProperties || {}).shape || 1));
          main.name = (propsName ? propsName + ', ' : '') + 'shape=' + (Math.max(...shapes) + 1);
        }
        owner.appendChild(main);
      }
      keepSize(main, size);
      r.added++;
      cursorY = Math.max(cursorY, owner.y + owner.height + 160);
    }
    for (const o of occs) {
      if (o.removed) continue;
      const inst = main.createInstance(); await copyOverrides(o, inst, row); place(o, inst); inst.name = ui; r.swapped++;
    }
  }
  if (!r.updated.length) delete r.updated;
}
report._textWarnings = textWarnings; report._gridWarnings = gridWarnings;
return report;
