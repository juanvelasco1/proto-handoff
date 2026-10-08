// use_figma script template — a table or list is one component whose rows live in a SLOT.
// The main holds what every table shares (header, footer, borders, padding, background) and a
// few sample rows; each screen's instance holds its own rows (instances of the row component)
// in the slot. Editing the table's main edits every table; editing the row's main edits every
// row. A list main no longer carries the longest occurrence's rows (a 279-row main).
//
// phase 'build' (Components page): per list component, each variant is cloned, its row box
//   turned into auto layout (a one-column CSS grid → vertical), its rows (and the component
//   items between them: menu labels, dividers) wrapped in a frame bound to a SLOT property
//   ("Rows"), trimmed to PARAMS.keep sample rows. Variants that are then the same structure
//   become one. The old component stays, renamed "(previous)", until 'move' empties it.
// phase 'move' (a batch of screens): every instance of an old variant becomes an instance of
//   its new variant; content outside the rows is copied as overrides, each visible row is
//   rebuilt in the slot as an instance of its own main with its overrides.
// phase 'drop': old components with no instance left on a page are removed.
// Lists on a multi-column grid (stat strips, property grids) keep their grid: a slot can't be a
// grid. Re-runnable: a list already built is skipped, an instance already moved isn't found.
const PARAMS = /*PARAMS*/ { componentsPage: '', lists: {}, only: null, phase: 'build', frames: [], keep: 5 } /*END*/;
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
const inInstance = (n) => { for (let p = n.parent; p; p = p.parent) { if (p.type === 'SLOT') return false; if (p.type === 'INSTANCE') return true; } return false; };
const onPage = (n) => { for (let p = n.parent; p; p = p.parent) if (p.type === 'PAGE') return true; return false; };
const ownerOf = (ui, old) => compPage.findOne((n) => (n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && n.parent.type !== 'COMPONENT_SET'))
  && n.getSharedPluginData('uic', 'component') === ui && (n.getSharedPluginData('uic', 'old') === '1') === !!old);
const isItem = (c) => c.type === 'INSTANCE' || !!c.getSharedPluginData('uic', 'ui');
// the rows and the component items around them (a menu's labels and dividers) — not a header
function rangeOf(box, row) {
  const k = box.children;
  let a = k.findIndex((c) => isRowOf(c, row)), b = k.length - 1;
  while (!isRowOf(k[b], row)) b--;
  while (a > 0 && isItem(k[a - 1])) a--;
  while (b < k.length - 1 && isItem(k[b + 1])) b++;
  return [a, b];
}
const pathTo = (root, box) => { const p = []; for (let q = box; q !== root; q = q.parent) p.unshift(q.parent.children.indexOf(q)); return p; };
const nodeAt = (root, path) => path.reduce((n, i) => n.children[i], root);
const slotOf = (n) => n.findAllWithCriteria({ types: ['SLOT'] })[0] || null;

// a one-column grid is a vertical stack
function unGrid(box) {
  if (box.layoutMode !== 'GRID') return true;
  if (box.gridColumnCount !== 1) return false;
  const kids = box.children.slice().sort((a, b) => a.gridRowAnchorIndex - b.gridRowAnchorIndex);
  const gap = box.gridRowGap || 0;
  box.layoutMode = 'VERTICAL';
  box.itemSpacing = gap;
  kids.forEach((k, i) => box.insertChild(i, k));
  for (const k of kids) { try { k.layoutSizingHorizontal = 'FILL'; } catch (e) {} }
  return true;
}
function hugUp(n, top) {
  for (let q = n; q; q = q.parent) {
    if ('layoutMode' in q && q.layoutMode === 'VERTICAL') { try { q.primaryAxisSizingMode = 'AUTO'; } catch (e) {} }
    else if ('layoutMode' in q && q.layoutMode === 'HORIZONTAL') { try { q.counterAxisSizingMode = 'AUTO'; } catch (e) {} }
    if (q === top) break;
  }
}
// the non-slot structure of a slotted main: what makes two variants the same table
const slotSig = (n) => {
  if (n.type === 'SLOT') return 'S';
  if (n.type === 'INSTANCE') return 'I';
  if (!('children' in n) || !n.children.length) return n.type[0];
  return n.type[0] + '[' + n.children.map(slotSig).join(',') + ']';
};
const propsOf = (v) => { const p = Object.assign({}, v.variantProperties || {}); delete p.shape; return p; };

const report = { phase: PARAMS.phase };

if (PARAMS.phase === 'build') {
  await figma.setCurrentPageAsync(compPage);
  for (const [ui, row] of Object.entries(PARAMS.lists)) {
    if (PARAMS.only && !PARAMS.only.includes(ui)) continue;
    if (ownerOf(ui, true)) { report[ui] = 'built already'; continue; }
    const owner = ownerOf(ui, false);
    if (!owner) { report[ui] = 'missing'; continue; }
    const variants = owner.type === 'COMPONENT_SET' ? [...owner.children] : [owner];
    const r = report[ui] = { before: variants.length, after: 0, skipped: [] };
    const made = [];
    for (const v of variants) {
      const box0 = rowsBox(v, row);
      if (!box0 || (box0.layoutMode === 'GRID' && box0.gridColumnCount !== 1)) { r.skipped.push(v.name); continue; }
      const c = v.clone();
      compPage.appendChild(c);
      const box = nodeAt(c, pathTo(v, box0));
      unGrid(box);
      const [a, b] = rangeOf(box, row);
      const kids = box.children.slice(a, b + 1);
      const w = figma.createFrame();
      w.name = 'Rows';
      w.layoutMode = box.layoutMode === 'HORIZONTAL' ? 'HORIZONTAL' : 'VERTICAL';
      w.itemSpacing = box.itemSpacing || 0;
      w.fills = [];
      w.clipsContent = false;
      box.insertChild(a, w);
      for (const k of kids) w.appendChild(k);
      try { w.layoutSizingHorizontal = 'FILL'; } catch (e) {}
      try { w.layoutSizingVertical = 'HUG'; } catch (e) {}
      for (const k of kids) { try { k.layoutSizingHorizontal = 'FILL'; } catch (e) {} }
      // sample rows only: the screens bring their own
      let rows = 0;
      for (const k of [...w.children]) { if (isRowOf(k, row) && ++rows > PARAMS.keep) k.remove(); else if (rows > PARAMS.keep) k.remove(); }
      for (const k of [...w.children]) if (!k.visible) k.remove();
      hugUp(w, c);
      c.setSharedPluginData('uic', 'from', v.id);
      made.push({ v, c });
    }
    if (!made.length) { report[ui] = 'grid list: kept as is'; continue; }
    // one variant per props value and structure
    const groups = new Map();
    for (const m of made) {
      const k = JSON.stringify(propsOf(m.v)) + '|' + slotSig(m.c);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(m);
    }
    const keepers = [];
    for (const list of groups.values()) {
      list.sort((x, y) => y.c.width - x.c.width);
      const t = list[0];
      for (const m of list) { m.v.setSharedPluginData('uic', 'to', t.c.id); if (m !== t) m.c.remove(); }
      keepers.push(t);
    }
    // names: props, plus a structure number when one props value has several structures
    const byProps = {};
    for (const t of keepers) (byProps[JSON.stringify(propsOf(t.v))] = byProps[JSON.stringify(propsOf(t.v))] || []).push(t);
    const needShape = Object.values(byProps).some((l) => l.length > 1);
    for (const l of Object.values(byProps)) l.forEach((t, i) => {
      const p = Object.entries(propsOf(t.v)).map(([k, x]) => `${k}=${x}`);
      if (needShape || !p.length) p.push(`tipo=${i + 1}`);
      t.c.name = p.join(', ');
    });
    let nu;
    if (keepers.length > 1 || owner.type === 'COMPONENT_SET') {
      nu = figma.combineAsVariants(keepers.map((t) => t.c), compPage);
      nu.layoutMode = 'HORIZONTAL'; nu.layoutWrap = 'WRAP'; nu.itemSpacing = 40; nu.counterAxisSpacing = 40;
      nu.paddingLeft = nu.paddingRight = nu.paddingTop = nu.paddingBottom = 40;
      nu.primaryAxisSizingMode = 'FIXED'; nu.counterAxisSizingMode = 'AUTO';
      nu.resize(Math.max(...keepers.map((t) => t.c.width)) * Math.min(2, keepers.length) + 120, nu.height);
    } else nu = keepers[0].c;
    nu.name = ui;
    nu.description = owner.description;
    nu.setSharedPluginData('uic', 'component', ui);
    nu.x = owner.absoluteBoundingBox ? owner.absoluteBoundingBox.x + owner.width + 400 : 0;
    nu.y = owner.absoluteBoundingBox ? owner.absoluteBoundingBox.y : 0;
    const key = nu.addComponentProperty(ui === 'Menu' ? 'Content' : 'Rows', 'SLOT', '');
    for (const t of keepers) t.c.findOne((n) => n.name === 'Rows' && n.type === 'FRAME').componentPropertyReferences = { slotContentId: key };
    owner.name = ui + ' (previous)';
    owner.setSharedPluginData('uic', 'old', '1');
    r.after = keepers.length;
    r.id = nu.id;
  }
}

if (PARAMS.phase === 'move') {
  const olds = {};
  for (const ui of Object.keys(PARAMS.lists)) { const o = ownerOf(ui, true); if (o) olds[o.id] = ui; }
  const oldVariant = async (inst) => {
    const m = await inst.getMainComponentAsync();
    if (!m) return null;
    const own = m.parent && m.parent.type === 'COMPONENT_SET' ? m.parent : m;
    return olds[own.id] ? { m, ui: olds[own.id] } : null;
  };
  const r = report.moved = {}; report.rows = 0; report.rawRows = 0; report.frames = 0;
  for (const fid of PARAMS.frames) {
    const frame = await figma.getNodeByIdAsync(fid);
    if (!frame) continue;
    report.frames++;
    const cands = frame.findAllWithCriteria({ types: ['INSTANCE'] }).filter((n) => !inInstance(n));
    for (const inst of cands) {
      if (inst.removed) continue;
      const hit = await oldVariant(inst);
      if (!hit) continue;
      const row = PARAMS.lists[hit.ui];
      const to = await figma.getNodeByIdAsync(hit.m.getSharedPluginData('uic', 'to'));
      if (!to) continue;
      const fresh = to.createInstance();
      // everything but the rows: same tree down to the row box
      const oBox = rowsBox(inst, row);
      const slot = slotOf(fresh);
      if (!oBox || !slot) { fresh.remove(); continue; }
      const path = pathTo(inst, oBox);
      let o = inst, n = fresh;
      for (const k of ['fills', 'strokes', 'effects', 'opacity']) if (k in o && o[k] !== figma.mixed && !eq(o[k], n[k])) { try { n[k] = o[k]; } catch (e) {} }
      for (const idx of path) {
        for (let i = 0; i < o.children.length && i < n.children.length; i++) if (i !== idx) await copyOverrides(o.children[i], n.children[i], null);
        o = o.children[idx]; n = n.children[idx];
        for (const k of ['fills', 'strokes', 'effects', 'visible', 'opacity']) if (k in o && o[k] !== figma.mixed && !eq(o[k], n[k])) { try { n[k] = o[k]; } catch (e) {} }
      }
      // o: the old row box; n: the new one, the slot where the rows were
      const [a, b] = rangeOf(o, row);
      const ok = o.children, nk = n.children, si = nk.indexOf(slot.parent === n ? slot : nk.find((x) => x.type === 'SLOT'));
      for (let i = 0; i < a && i < si; i++) await copyOverrides(ok[i], nk[i], null);
      for (let i = 1; b + i < ok.length && si + i < nk.length; i++) await copyOverrides(ok[b + i], nk[si + i], null);
      for (const d of [...slot.children]) d.remove();
      for (const c of ok.slice(a, b + 1)) {
        if (!c.visible) continue;
        let f;
        if (c.type === 'INSTANCE') {
          const m = await c.getMainComponentAsync();
          f = m.createInstance();
          slot.appendChild(f);
          await copyOverrides(c, f, null, true);
        } else { f = c.clone(); slot.appendChild(f); if (isRowOf(c, row)) report.rawRows++; }
        try { f.layoutSizingHorizontal = 'FILL'; } catch (e) {}
        report.rows++;
      }
      place(inst, fresh);
      r[hit.ui] = (r[hit.ui] || 0) + 1;
    }
  }
}

if (PARAMS.phase === 'drop') {
  await figma.setCurrentPageAsync(compPage);
  report.dropped = []; report.kept = {};
  for (const ui of Object.keys(PARAMS.lists)) {
    const o = ownerOf(ui, true);
    if (!o) continue;
    const vs = o.type === 'COMPONENT_SET' ? [...o.children] : [o];
    let left = 0;
    for (const v of vs) left += (await v.getInstancesAsync()).filter(onPage).length;
    if (left) { report.kept[ui] = left; continue; }
    o.remove();
    report.dropped.push(ui);
  }
}
report._textWarnings = textWarnings;
return report;
