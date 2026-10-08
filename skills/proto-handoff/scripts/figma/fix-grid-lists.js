// use_figma script template — lists laid out on a CSS grid keep their responsive behavior.
// The capture turns `1fr` tracks into fixed pixels, so one list main can't serve a narrower
// screen, and `repeat(auto-fit, …)` into one column count per width. This:
//   1. makes every grid list's tracks FLEX (same proportions), the grid fill its main and each
//      row fill its cell: an instance reflows to the width it has on its screen;
//   2. for lists whose column count changes with the width (a stat strip is 3, 4, 5 or 6 cards
//      across), keeps one variant per count (`columnas=N`) and puts each instance on the one its
//      screen had in the browser (the DOM map says: columns = distinct x of its rows).
// Instances nested in another instance follow their host. Re-runnable.
const PARAMS = /*PARAMS*/ { componentsPage: '', lists: {}, cols: {} } /*END*/;
// cols: { "<frame id>": [[ui, x, y, w, columns, rows], …] } — from the DOM map, frame-relative
/*SHAPE*/

const compPage = await figma.getNodeByIdAsync(PARAMS.componentsPage);
await figma.setCurrentPageAsync(compPage);
const LAYOUT_KEYS = ['layoutPositioning', 'layoutAlign', 'layoutGrow', 'gridChildHorizontalAlign', 'gridChildVerticalAlign'];
function place(o, inst) {
  const parent = o.parent, idx = parent.children.indexOf(o);
  const auto = 'layoutMode' in parent && parent.layoutMode !== 'NONE';
  const keep = {};
  for (const k of LAYOUT_KEYS.concat(['layoutSizingHorizontal', 'layoutSizingVertical', 'x', 'y', 'width', 'height', 'constraints', 'name'])) if (k in o) keep[k] = o[k];
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
  inst.name = keep.name;
  for (const k in data) if (data[k]) inst.setSharedPluginData('uic', k, data[k]);
  if (grid) { try { inst.gridRowSpan = grid.rs; inst.gridColumnSpan = grid.cs; inst.setGridChildPosition(grid.r, grid.c); } catch (e) { gridWarnings++; } }
}
const inInstance = (n) => { for (let p = n.parent; p; p = p.parent) if (p.type === 'INSTANCE') return true; return false; };
const gridOf = (n, row) => { const b = rowsBox(n, row); return b && b.layoutMode === 'GRID' ? b : null; };

// a grid that fills its main, flexible tracks, rows filling their cells
function flexify(v, row, cols) {
  const box = gridOf(v, row);
  if (!box) return false;
  const rows = box.children.filter((c) => isRowOf(c, row));
  if (cols && cols !== box.gridColumnCount) {
    // an occupied track can't be deleted: park every cell in spare rows, place them, then trim
    const need = Math.max(1, Math.ceil(rows.length / cols)), kids = box.children;
    box.gridRowCount = Math.max(box.gridRowCount, need) + kids.length;
    if (cols > box.gridColumnCount) box.gridColumnCount = cols;
    const spare = box.gridRowCount - kids.length;
    kids.forEach((c, i) => c.setGridChildPosition(spare + i, 0));
    kids.forEach((c, i) => c.setGridChildPosition(Math.floor(i / cols), i % cols));
    box.gridColumnCount = cols;
    box.gridRowCount = Math.max(need, Math.ceil(kids.length / cols));
    try { box.gridRowSizes = Array.from({ length: box.gridRowCount }, () => ({ type: 'HUG' })); } catch (e) {}
  }
  const px = box.gridColumnSizes.map((s) => s.value || 1), total = px.reduce((a, b) => a + b, 0);
  try { box.gridColumnSizes = px.map((p) => ({ type: 'FLEX', value: Math.round((p / total) * px.length * 100) / 100 })); } catch (e) { gridWarnings++; }
  if (box !== v && box.layoutPositioning !== 'ABSOLUTE') { try { box.layoutSizingHorizontal = 'FILL'; } catch (e) {} }
  for (const c of box.children) { try { c.layoutSizingHorizontal = 'FILL'; } catch (e) {} }
  return true;
}

const report = {};
for (const [ui, row] of Object.entries(PARAMS.lists)) {
  const owner = compPage.findOne((n) => (n.type === 'COMPONENT_SET' || n.type === 'COMPONENT') && n.getSharedPluginData('uic', 'component') === ui);
  if (!owner) continue;
  const r = report[ui] = { flex: 0, created: 0, moved: 0, unmatched: 0 };
  const variants = owner.type === 'COMPONENT_SET' ? [...owner.children] : [owner];
  for (const v of variants) if (flexify(v, row)) r.flex++;
  // the column counts this list has on screens; one count only: nothing more to do
  const wanted = new Set();
  for (const l of Object.values(PARAMS.cols)) for (const o of l) if (o[0] === ui && o[4] > 0) wanted.add(o[4]);
  if (wanted.size < 2 || owner.type !== 'COMPONENT_SET') continue;
  // every variant says its column count
  const colsOf = (v) => { const g = gridOf(v, row); return g ? g.gridColumnCount : 1; };
  const baseName = (v) => v.name.split(/,\s*/).filter((p) => !p.startsWith('columnas=')).join(', ');
  for (const v of owner.children) v.name = `${baseName(v)}, columnas=${colsOf(v)}`;
  const variantFor = (v, cols) => {
    if (colsOf(v) === cols) return v;
    const name = `${baseName(v)}, columnas=${cols}`;
    let t = owner.children.find((x) => x.name === name);
    if (!t) { t = v.clone(); owner.appendChild(t); t.name = name; flexify(t, row, cols); r.created++; }
    return t;
  };
  for (const [frameId, occ] of Object.entries(PARAMS.cols)) {
    const mine = occ.filter((o) => o[0] === ui && o[4] > 0);
    if (!mine.length) continue;
    const frame = await figma.getNodeByIdAsync(frameId);
    if (!frame) continue;
    const fb = frame.absoluteBoundingBox;
    const insts = frame.findAll((n) => n.type === 'INSTANCE' && n.name === ui && !inInstance(n))
      .map((n) => ({ n, x: n.absoluteBoundingBox.x - fb.x, y: n.absoluteBoundingBox.y - fb.y }));
    // same count on the screen as in the DOM: reading order pairs them even after a wrong
    // layout pushed everything below it down
    const byRank = insts.length === mine.length;
    const order = (l, X, Y) => l.slice().sort((a, b) => Y(a) - Y(b) || X(a) - X(b));
    const rankedI = order(insts, (a) => a.x, (a) => a.y), rankedO = order(mine, (a) => a[1], (a) => a[2]);
    for (const { n: inst, x, y } of insts) {
      // otherwise the capture wraps some boxes (a few px of padding): nearest within a margin
      const o = byRank ? rankedO[rankedI.findIndex((e) => e.n === inst)]
        : mine.filter((m) => Math.abs(m[1] - x) <= 12 && Math.abs(m[2] - y) <= 24)
          .sort((a, b) => Math.hypot(a[1] - x, a[2] - y) - Math.hypot(b[1] - x, b[2] - y))[0];
      if (!o) { r.unmatched++; continue; }
      const v = await inst.getMainComponentAsync();
      const t = variantFor(v, o[4]);
      if (t === v) continue;
      const fresh = t.createInstance();
      await copyOverrides(inst, fresh, row, true);
      place(inst, fresh);
      r.moved++;
    }
  }
}
report._gridWarnings = gridWarnings;
return report;
