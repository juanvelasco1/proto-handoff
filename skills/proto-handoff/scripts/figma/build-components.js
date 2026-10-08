// use_figma script template — builds component sets from tagged occurrences and swaps every
// occurrence for an instance. Fill the PARAMS block, run once per batch of component names,
// inner components first (an InboxRow must be built after the Avatar it contains).
//
// An occurrence is swapped only when its layer structure matches its variant's main
// component; anything else is left as is and reported, never forced.
const PARAMS = /*PARAMS*/ { ui: [], screens: [], componentsPage: '', codeRefs: {}, origin: [0, 0], lists: {} } /*END*/;
// lists: { "ProductTable": "ProductRow" } — a component made of repeated rows (see lib/figma-shape.js)

const compPage = await figma.getNodeByIdAsync(PARAMS.componentsPage);
const frames = [];
for (const id of PARAMS.screens) { const f = await figma.getNodeByIdAsync(id); if (f) frames.push(f); }

/*SHAPE*/
const variantName = (props) => props.trim().split(/\s+/).filter(Boolean).join(', ');

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

// every tagged occurrence of the requested components, in reading order
const inInstance = (n, root) => { for (let p = n.parent; p && p !== root; p = p.parent) if (p.type === 'INSTANCE') return true; return false; };
const occ = {};
for (const f of frames) {
  // an instance carries its main's tag: it (and every layer inside it) is already a component
  const found = f.findAll((n) => n.type !== 'INSTANCE' && PARAMS.ui.includes(n.getSharedPluginData('uic', 'ui')) && !inInstance(n, f));
  for (const n of found) {
    const ui = n.getSharedPluginData('uic', 'ui');
    (occ[ui] = occ[ui] || []).push(n);
  }
}

// inner components first: a component nested in another must exist before its host is built
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
PARAMS.ui.sort((a, b) => (height[a] || 0) - (height[b] || 0));

let cursorY = PARAMS.origin[1];
for (const c of compPage.children) cursorY = Math.max(cursorY, c.y + c.height + 160);
const report = {};
for (const ui of PARAMS.ui) {
  const list = occ[ui] || [];
  const row = LISTS[ui] || null;
  if (!list.length) { report[ui] = { occurrences: 0 }; continue; }
  const groups = {};
  for (const n of list) (groups[n.getSharedPluginData('uic', 'props')] = groups[n.getSharedPluginData('uic', 'props')] || []).push(n);
  const keys = Object.keys(groups).sort();
  const hasProps = keys.some((k) => k.trim());
  // One variant per props value and recurring structure. A structure seen at least MIN_SHAPE
  // times becomes its own variant (shape=2, shape=3…) instead of leaving those occurrences
  // unswapped; rarer structures stay as they are and are reported.
  const MIN_SHAPE = 2;
  const plan = [];
  for (const k of keys) {
    const bySig = {};
    for (const n of groups[k]) (bySig[shapeKey(n, row)] = bySig[shapeKey(n, row)] || []).push(n);
    // a list (a table) is often unique per screen: every configuration of it is a variant
    const shapes = Object.entries(bySig).sort((a, b) => b[1].length - a[1].length)
      .filter(([, l], i) => i === 0 || l.length >= (row ? 1 : MIN_SHAPE));
    // the representative is the occurrence with the most common size: a one-off stretched copy
    // would otherwise define the main
    const modal = (l) => {
      // a list's main is its longest occurrence: shorter ones hide the rows they don't have
      if (row) return l.slice().sort((a, b) => rowCount(b, row) - rowCount(a, row))[0];
      const by = {};
      for (const o of l) { const key = Math.round(o.width) + 'x' + Math.round(o.height); (by[key] = by[key] || []).push(o); }
      return Object.values(by).sort((a, b) => b.length - a.length)[0][0];
    };
    shapes.forEach(([s, l], i) => plan.push({ k, shape: i + 1, sig: s, rep: modal(l) }));
  }
  const multiShape = plan.some((p) => p.shape > 1);
  const hasVariants = hasProps || multiShape;
  const mains = {};
  const created = [];
  let x = PARAMS.origin[0];
  for (const p of plan) {
    const clone = p.rep.clone();
    compPage.appendChild(clone);
    p.size = [p.rep.width, p.rep.height];
    clone.x = x; clone.y = cursorY; x += clone.width + 40;
    const comp = figma.createComponentFromNode(clone);
    const props = (p.k.trim() ? variantName(p.k) : '') + (multiShape ? (p.k.trim() ? ', ' : '') + 'shape=' + p.shape : '');
    comp.name = hasVariants ? props : ui;
    mains[p.k + '|' + p.sig] = comp; created.push(comp); p.comp = comp;
  }
  // a captured box that hugged its content inside the page can collapse once it stands alone
  // (a grid row, a frame without auto layout): each main keeps the size it had on screen
  const keepSize = () => {
    for (const p of plan) {
      const c = p.comp, [w, h] = p.size;
      if (Math.abs(c.width - w) <= 0.5 && Math.abs(c.height - h) <= 0.5) continue;
      try { if (c.parent.type === 'COMPONENT_SET') { c.layoutSizingHorizontal = 'FIXED'; c.layoutSizingVertical = 'FIXED'; } } catch (e) {}
      if (c.layoutMode === 'HORIZONTAL' || c.layoutMode === 'VERTICAL') { c.primaryAxisSizingMode = 'FIXED'; c.counterAxisSizingMode = 'FIXED'; }
      c.resize(Math.max(w, 0.01), Math.max(h, 0.01));
      report._resized = (report._resized || 0) + 1;
    }
  };
  keepSize();
  let owner;
  if (hasVariants) {
    owner = figma.combineAsVariants(created, compPage);
    owner.name = ui;
    owner.x = PARAMS.origin[0]; owner.y = cursorY;
    owner.layoutMode = 'HORIZONTAL'; owner.itemSpacing = 32; owner.paddingLeft = owner.paddingRight = owner.paddingTop = owner.paddingBottom = 32;
    owner.layoutWrap = 'WRAP'; owner.counterAxisSpacing = 32;
    owner.primaryAxisSizingMode = 'AUTO'; owner.counterAxisSizingMode = 'AUTO';
    owner.counterAxisAlignItems = 'CENTER';
    keepSize();
  } else {
    owner = created[0];
  }
  // the incremental path (swap-existing.js) finds a component by this tag
  owner.setSharedPluginData('uic', 'component', ui);
  const ref = PARAMS.codeRefs[ui];
  owner.description = ref ? `Del prototipo: ${ref}` : 'Del prototipo.';
  cursorY = owner.y + owner.height + 160;

  // slot text → component text property, so designers edit labels from the panel
  const slotsJson = list[0].getSharedPluginData('uic', 'slots');
  const slotProps = [];
  if (slotsJson) {
    const slots = JSON.parse(slotsJson);
    for (const [slot, value] of Object.entries(slots)) {
      if (!value) continue;
      // only the text inside the layer tagged with this slot: a guess (the first text of a
      // variant that lacks the slot) binds the property to the wrong layer, e.g. a count
      // label that then shows the row's name
      const inSlot = (c) => {
        const box = c.findOne((n) => n.getSharedPluginData('uic', 'slot') === slot);
        return box && (box.type === 'TEXT' ? box : box.findOne((t) => t.type === 'TEXT'));
      };
      const texts = created.map(inSlot).filter(Boolean);
      if (!texts.length) continue;
      try {
        const key = owner.addComponentProperty(slot, 'TEXT', (texts.find((t) => t.characters.replace(/\s+/g, ' ').trim() === value) || texts[0]).characters);
        for (const t of texts) { await loadFontsOf(t); t.componentPropertyReferences = { characters: key }; }
        slotProps.push(slot);
      } catch (e) { /* a slot shared with another property, skip */ }
    }
  }

  // swap occurrences
  let swapped = 0, kept = 0, overrides = 0;
  for (const k of keys) {
    for (const o of groups[k]) {
      const main = mains[k + '|' + shapeKey(o, row)];
      if (!main) { o.name = `${ui} · not swapped`; kept++; continue; }
      if (o.removed) continue;
      const inst = main.createInstance();
      overrides += await copyOverrides(o, inst, row);
      place(o, inst);
      inst.name = ui;
      swapped++;
    }
  }
  report[ui] = { occurrences: list.length, variants: plan.length, swapped, kept, overrides, slotProps, id: owner.id };
}
report._textWarnings = textWarnings;
report._gridWarnings = gridWarnings;
return report;
