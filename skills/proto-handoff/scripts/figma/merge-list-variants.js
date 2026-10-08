// use_figma script template — one list component per structure. The same table captured on
// several screens is one table at different widths and lengths; when geometry still counted in
// a list's shape, each of those became its own variant (shape=N). This keeps, per props value and
// structure, the variant with the most rows (the widest on a tie), moves every instance of the
// others onto it — content copied row by row, the rows an instance didn't have hidden, its size
// kept — and deletes the emptied variants. Editing that one main then edits every table.
// An instance nested in another instance follows its host's main and is left alone.
// Re-runnable: a list with one variant per structure is left as is.
const PARAMS = /*PARAMS*/ { componentsPage: '', lists: {}, only: null } /*END*/;
/*SHAPE*/

const compPage = await figma.getNodeByIdAsync(PARAMS.componentsPage);
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
// getInstancesAsync can still return instances of a subtree that was deleted: they hang off no page
const onPage = (n) => { for (let p = n.parent; p; p = p.parent) if (p.type === 'PAGE') return true; return false; };
const propsOf = (v) => { const p = Object.assign({}, v.variantProperties || {}); delete p.shape; return JSON.stringify(p); };

const report = {};
for (const [ui, row] of Object.entries(PARAMS.lists)) {
  if (PARAMS.only && !PARAMS.only.includes(ui)) continue;
  const owner = compPage.findOne((n) => (n.type === 'COMPONENT_SET' || n.type === 'COMPONENT') && n.getSharedPluginData('uic', 'component') === ui);
  if (!owner || owner.type !== 'COMPONENT_SET') continue;
  const groups = {};
  for (const v of owner.children) { const k = propsOf(v) + '|' + sig(v, row); (groups[k] = groups[k] || []).push(v); }
  const r = { before: owner.children.length, moved: 0, nested: 0, removed: 0 };
  for (const vs of Object.values(groups)) {
    if (vs.length < 2) continue;
    vs.sort((a, b) => rowCount(b, row) - rowCount(a, row) || b.width - a.width);
    const target = vs[0];
    for (const v of vs.slice(1)) {
      for (const inst of await v.getInstancesAsync()) {
        if (!onPage(inst)) continue;
        if (inInstance(inst)) { r.nested++; continue; }
        const fresh = target.createInstance();
        await copyOverrides(inst, fresh, row, true);
        place(inst, fresh);
        r.moved++;
      }
      // a variant still used inside another instance stays until that host is rebuilt
      if (!(await v.getInstancesAsync()).some(onPage)) { v.remove(); r.removed++; }
    }
  }
  // shapes renumbered 1…n per props value; the property goes when no props value has two
  const byProps = {};
  for (const v of owner.children) (byProps[propsOf(v)] = byProps[propsOf(v)] || []).push(v);
  const needShape = Object.values(byProps).some((l) => l.length > 1);
  for (const l of Object.values(byProps)) l.forEach((v, i) => {
    const p = Object.entries(JSON.parse(propsOf(v))).map(([k, x]) => `${k}=${x}`);
    if (needShape || !p.length) p.push(`shape=${i + 1}`);
    v.name = p.join(', ');
  });
  r.after = owner.children.length;
  report[ui] = r;
}
report._textWarnings = textWarnings;
return report;
