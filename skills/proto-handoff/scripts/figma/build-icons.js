// use_figma script template — turns every tagged glyph (sharedPluginData uic.icon, set by the
// annotation) into an instance of an Icon/<name> component. Runs BEFORE build-components.js
// and swap-existing.js: a component that contains icons then holds icon INSTANCES, and each
// occurrence swaps its own glyph (an instance swap is an override; a vector's geometry is not).
//
// Incremental: an Icon/<name> that already exists on the Components page is reused, so the
// same script serves the first build and every later update.
const PARAMS = /*PARAMS*/ { screens: [], componentsPage: '' } /*END*/;

const compPage = await figma.getNodeByIdAsync(PARAMS.componentsPage);
const frames = [];
for (const id of PARAMS.screens) { const f = await figma.getNodeByIdAsync(id); if (f) frames.push(f); }

// existing icon components, and the board that holds them
let board = compPage.findOne((n) => n.getSharedPluginData('uic', 'board') === 'icons');   // may sit inside a category card
const mains = {};
if (board) for (const c of board.children) { const k = c.getSharedPluginData('uic', 'component'); if (k) mains[k] = c; }

const occ = {};
for (const f of frames) {
  const found = f.findAll((n) => n.getSharedPluginData('uic', 'icon') !== '');
  for (const n of found) {
    let p = n.parent, inInstance = false;
    // skip glyphs inside an instance, or inside another glyph (an svg nested in an svg box)
    while (p && p !== f) { if (p.type === 'INSTANCE' || p.getSharedPluginData('uic', 'icon') !== '') { inInstance = true; break; } p = p.parent; }
    if (inInstance || n.type === 'INSTANCE') continue;
    const name = n.getSharedPluginData('uic', 'icon');
    (occ[name] = occ[name] || []).push(n);
  }
}

if (!board && Object.keys(occ).length) {
  board = figma.createAutoLayout('HORIZONTAL', { name: 'Icons', itemSpacing: 24 });
  board.layoutWrap = 'WRAP'; board.counterAxisSpacing = 24;
  board.paddingLeft = board.paddingRight = board.paddingTop = board.paddingBottom = 32;
  board.fills = [];
  compPage.appendChild(board);
  let y = 0; for (const c of compPage.children) if (c !== board) y = Math.max(y, c.y + c.height + 160);
  board.x = 0; board.y = y;
  board.resize(1200, board.height); board.primaryAxisSizingMode = 'FIXED';
  board.setSharedPluginData('uic', 'board', 'icons');
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// the glyph's color goes to its shapes, never to a box: the capture paints an svg's frame with
// currentColor (or a CSS mask icon comes as a filled box), and copied onto the instance's frame it
// drew a solid square where the chevron was (4 on one screen). The mains have no box fill
const isBox = (n) => n.type === 'FRAME' || n.type === 'GROUP' || n.type === 'INSTANCE' || n.type === 'COMPONENT';
function copyPaints(src, dst) {
  for (const k of ['fills', 'strokes', 'opacity']) {
    if (k === 'fills' && isBox(dst)) continue;
    if (k in src && k in dst && src[k] !== figma.mixed && !eq(src[k], dst[k])) { try { dst[k] = src[k]; } catch (e) {} }
  }
  if ('children' in src && 'children' in dst && src.children.length === dst.children.length) src.children.forEach((c, i) => copyPaints(c, dst.children[i]));
}

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
const report = { created: 0, reused: 0, swapped: 0, gridWarnings: 0 };
for (const [name, list] of Object.entries(occ)) {
  const key = 'Icon/' + name;
  let main = mains[key];
  if (!main) {
    // the representative is the most common size; vectors scale with the instance
    const bySize = {};
    for (const n of list) { const k = Math.round(n.width) + 'x' + Math.round(n.height); (bySize[k] = bySize[k] || []).push(n); }
    const rep = Object.values(bySize).sort((a, b) => b.length - a.length)[0][0];
    const clone = rep.clone();
    board.appendChild(clone);
    main = figma.createComponentFromNode(clone);
    main.name = key;
    for (const v of main.findAll(() => true)) if ('constraints' in v) v.constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
    main.description = 'Glyph from the prototype (data-ui-icon="' + name + '").';
    main.setSharedPluginData('uic', 'component', key);
    mains[key] = main; report.created++;
  } else report.reused++;
  for (const o of list) {
    if (o.removed) continue;
    const inst = main.createInstance();
    const parent = o.parent, idx = parent.children.indexOf(o);
    const auto = 'layoutMode' in parent && parent.layoutMode !== 'NONE';
    const keep = {};
    for (const k of ['layoutPositioning', 'layoutAlign', 'layoutGrow', 'gridChildHorizontalAlign', 'gridChildVerticalAlign', 'x', 'y', 'width', 'height', 'constraints']) if (k in o) keep[k] = o[k];
    const grid = parent.layoutMode === 'GRID' ? { r: o.gridRowAnchorIndex, c: o.gridColumnAnchorIndex } : null;
    // a turned glyph (a chevron rotated to point right) has its x/y at its origin corner, which the
    // turn carries to another corner (10 px below its box): the instance, upright with the turn
    // inside its main, goes where the glyph's box is
    if (Math.abs(o.rotation || 0) > 0.5 && o.absoluteBoundingBox && parent.absoluteTransform) {
      const bb = o.absoluteBoundingBox, pt = parent.absoluteTransform;
      keep.x = bb.x - pt[0][2]; keep.y = bb.y - pt[1][2]; keep.width = bb.width; keep.height = bb.height;
    }
    copyPaints(o, inst);   // glyph color follows its context (currentColor)
    if (!o.visible) inst.visible = false;
    o.remove();            // leave first: in a grid the occurrence holds its cell
    parent.insertChild(Math.min(idx, parent.children.length), inst);
    for (const k of ['layoutPositioning', 'layoutAlign', 'layoutGrow', 'gridChildHorizontalAlign', 'gridChildVerticalAlign']) if (auto && k in keep) { try { inst[k] = keep[k]; } catch (e) {} }
    if (!auto || keep.layoutPositioning === 'ABSOLUTE') { inst.x = keep.x; inst.y = keep.y; }
    if (Math.abs(inst.width - keep.width) > 0.1 || Math.abs(inst.height - keep.height) > 0.1) inst.resize(keep.width, keep.height);
    if (keep.constraints) inst.constraints = keep.constraints;
    inst.name = 'icon/' + name;
    inst.setSharedPluginData('uic', 'iconInstance', name);
    if (grid) {
      try { inst.setGridChildPosition(grid.r, grid.c); } catch (e) { report.gridWarnings++; }
      trimGrid(parent);
    }
    report.swapped++;
  }
}
report.icons = Object.keys(occ).length;
return report;
