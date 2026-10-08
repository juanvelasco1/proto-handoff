// Plugin-API snippet (plain JS) inlined where a template says KIT, after SHAPE. The pieces the
// level builder (build-level.js) and the level swapper (swap-level.js) share:
//
//   occurrences  tagged layers of some components in a screen (instances and their insides skipped)
//   partKey/can  "a fits inside b": the same parts in the same order, b may have more (they hide)
//   specOf       where a list or a container keeps what changes from screen to screen (its slot)
//   copyInto     puts one occurrence's content on an instance: texts, fills, swaps, hidden parts
//   place        the instance takes the occurrence's place, size and grid cell
//
// A variant is never made from a width or a position: only from declared props and from parts
// that exist or not. What differs in size is left to auto layout, flexible grid tracks and
// constraints, inferred by comparing the occurrences of the same variant.
const U = (n, k) => n.getSharedPluginData('uic', k);
// a long synchronous run starves the bridge that carries the call: the transport drops and the
// whole call is lost. Long loops hand control back to the event loop every ~1.5 s
let BREATH = Date.now();
const breathe = async () => { if (Date.now() - BREATH > 1500) { await new Promise((r) => setTimeout(r, 0)); BREATH = Date.now(); } };
const SET = (n, k, v) => n.setSharedPluginData('uic', k, v);
// HUG is only valid on an auto layout frame or a text
const canHug = (n) => n.type === 'TEXT' || ('layoutMode' in n && n.layoutMode !== 'NONE');
// does a frame hug its content along an axis (a child filling that axis would collapse)
const hugsAxis = (p, horizontal) => {
  if (!p || !('layoutMode' in p) || (p.layoutMode !== 'VERTICAL' && p.layoutMode !== 'HORIZONTAL')) return false;
  return (p.layoutMode === 'HORIZONTAL') === horizontal ? p.primaryAxisSizingMode === 'AUTO' : p.counterAxisSizingMode === 'AUTO';
};
const KINDS = (typeof PARAMS !== 'undefined' && PARAMS.kinds) || {};
const kindOf = (ui) => KINDS[ui] || 'component';
const slotted = (ui) => kindOf(ui) === 'list' || kindOf(ui) === 'container';

// every tagged occurrence of `uis` in a frame, outermost first; a component already swapped
// (an instance) is skipped with everything inside it, so a batch can run twice
function occurrences(frame, uis) {
  const out = [];
  const walk = (n) => {
    if (n.type === 'INSTANCE') return;
    const ui = U(n, 'ui');
    if (ui && uis.has(ui) && n.type !== 'COMPONENT') out.push(n);
    if ('children' in n) for (const c of n.children) walk(c);
  };
  for (const c of frame.children) walk(c);
  return out;
}

// the identity of a part: an instance is any instance (which main is an override), a text any
// text; a frame is its name (the class or slot it came from); a shape its type
// STRICT: which component an instance is counts too. A variant takes any instance at a spot (the
// swap is an override), but a container's fixed part must be the same component on every screen
// (a section's header is always SectionHeader; its content — a list here, a chart there — is not)
let STRICT = false;
const strict = (fn) => { const was = STRICT; STRICT = true; try { return fn(); } finally { STRICT = was; } };
// an instance that holds a slot (a list, a container) carries its own content: it is never the
// "same" fixed part of a container, its content can only travel in the container's slot
const holdsSlot = (n) => n.type === 'INSTANCE' && n.children.some((c) => c.type === 'SLOT');
// a layer that only paints a picture (an <img>) is named by the capture after its alt text, one
// name per photo: keyed by name, 48 sheet photos became 27 variants
const isPicture = (n) => (n.type === 'FRAME' || n.type === 'RECTANGLE') && !('children' in n && n.children.length)
  && n.fills !== figma.mixed && n.fills.some((f) => f.type === 'IMAGE');
function partKey(n) {
  if (n.type === 'INSTANCE') return STRICT ? 'I:' + n.name + (holdsSlot(n) ? ':' + n.id : '') : 'I';
  if (n.type === 'TEXT') return 'T';
  if (isPicture(n)) return 'P';
  if (n.type === 'FRAME' || n.type === 'GROUP' || n.type === 'COMPONENT') return 'F:' + n.name;
  return n.type;
}
const memo = new Map();
// a fits in b: every part of a has its part in b, in order
function can(a, b) {
  const k = (STRICT ? 's' : '') + a.id + '|' + b.id;
  if (memo.has(k)) return memo.get(k);
  let r = partKey(a) === partKey(b);
  if (r && a.type !== 'INSTANCE' && 'children' in a) r = !!pick(a.children, b.children);
  memo.set(k, r);
  return r;
}
// ordered assignment of A into B (earliest fit), or null
function pick(A, B) {
  const n = A.length, m = B.length;
  if (n > m) return null;
  const f = [];
  for (let i = 0; i <= n; i++) f.push(new Array(m + 1).fill(i === n));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) f[i][j] = f[i][j + 1] || (can(A[i], B[j]) && f[i + 1][j + 1]);
  if (!f[0][0]) return null;
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) { while (!(can(A[i], B[j]) && f[i + 1][j + 1])) j++; out.push(j); j++; }
  return out;
}
// a → b for every part of a (assumes can(a, b))
function mapInto(a, b, map) {
  map.set(a, b);
  if (a.type === 'INSTANCE' || !('children' in a)) return map;
  const p = pick(a.children, b.children);
  a.children.forEach((c, i) => mapInto(c, b.children[p[i]], map));
  return map;
}
const same = (a, b) => can(a, b) && can(b, a);
// the shape of a grid that holds a slot: its column count (equal cells wrap the same way whatever
// their row count), or columns × rows when the cells differ. Occurrences of different shape can't
// share a main (a one-column group of tiles is not the two-column one). Read live on a raw grid;
// a main keeps the shape its grids had in the capture (gsig, stored when it was cloned): once the
// slot takes the cells, or the grid becomes auto layout, the live shape says nothing
function gridSig(f) {
  if (!f) return '';
  const stored = U(f, 'gsig');
  if (stored || f.layoutMode !== 'GRID') return stored || '';
  const k = f.children.filter((c) => c.layoutPositioning !== 'ABSOLUTE');
  if (!k.length) return 'g0';
  let cols = 0, rows = 0;
  try { cols = Math.max(...k.map((c) => c.gridColumnAnchorIndex + c.gridColumnSpan)); rows = Math.max(...k.map((c) => c.gridRowAnchorIndex + c.gridRowSpan)); } catch (e) { return 'g?'; }
  const equal = k.length > 1 && k.every((c) => { try { return c.gridRowSpan === 1 && c.gridColumnSpan === 1 && Math.abs(c.width - k[0].width) <= 1; } catch (e) { return false; } });
  return 'g' + cols + (equal || rows === 1 ? '' : 'x' + rows);
}
const gridAlike = (a, b) => gridSig(a) === gridSig(b);
// a CSS grid joins a variant only with the same declared columns (a 168 px label column is not the
// 240 or 330 px one: a grid track can't be overridden per instance). No code on either side: any
const sameCols = (o, r) => { const a = U(o, 'gc'), b = U(r, 'gc'); return !a || !b || a === b; };
// a list's rows can be any number: what has to match is how they run. 'v' a column, 'h' a line,
// 'w' lines that wrap, 'n' free layers, '*' a single row (runs either way)
function runShape(P, from, to) {
  const k = P.children.slice(from, to).filter((c) => c.layoutPositioning !== 'ABSOLUTE');
  if (k.length < 2) return '*';
  if (P.layoutMode === 'NONE') return 'n';
  if (P.layoutMode !== 'GRID') return P.layoutWrap === 'WRAP' ? 'w' : P.layoutMode === 'HORIZONTAL' ? 'h' : 'v';
  try {
    if (k.every((c) => c.gridRowAnchorIndex === k[0].gridRowAnchorIndex)) return 'h';
    if (k.every((c) => c.gridColumnAnchorIndex === k[0].gridColumnAnchorIndex)) return 'v';
  } catch (e) { return '?'; }
  return 'w';
}
// o's run of rows (a = its rows box) against the main's: the main's slot frame runs the way its
// auto layout says (a slot that wraps takes a line or a column too: its cards wrap where they fit)
function runFits(a, b, spec) {
  const got = runShape(a, spec.pre, a.children.length - spec.post);
  let want;
  const S = spec.wrap ? b.children.find((c) => U(c, 'slotWrap')) : (spec.slotPath ? b : null);
  if (S) want = S.layoutMode === 'NONE' ? 'n' : S.layoutWrap === 'WRAP' ? 'w' : S.layoutMode === 'HORIZONTAL' ? 'h' : S.layoutMode === 'VERTICAL' ? 'v' : runShape(S, 0, S.children.length);
  else want = runShape(b, spec.pre, b.children.length - spec.post);
  return got === want || got === '*' || want === '*' || want === 'w';
}
function size(n) { let s = 1; if (n.type !== 'INSTANCE' && 'children' in n) for (const c of n.children) s += size(c); return s; }
const nodeAt = (root, path) => { let n = root; for (const i of path) { if (!n || !('children' in n)) return null; n = n.children[i]; } return n; };

// ---- slots: what changes between screens -------------------------------------------------
// A list keeps its rows in a slot: the rows box is the frame whose children are the rows; the
// slot takes the run from the first row to the last (group titles and dividers in between go
// with them). A container keeps in a slot the children that are not the same in every
// occurrence; what is the same everywhere (a header, a footer) stays in the component, so
// editing it edits every screen.
// a row the capture kept inside its margin (margins that differ from row to row stay wrappers)
const inMargin = (c) => c.type === 'FRAME' && c.name === 'margin' && c.children.length === 1 ? c.children[0] : null;
// a row: tagged as one (an instance inherits the tag from its main), or an instance named after it.
// Any other instance (a bar drawn over the rows, a button after them) is not a row
const isRow = (c, row) => (c.type === 'INSTANCE' && c.name === row) || U(c, 'ui') === row;
const isItem = (c, row) => (!!row && isRow(c, row)) || (!!inMargin(c) && isItem(inMargin(c), row));
function rowsPath(n, row, path) {
  if (!('children' in n) || n.type === 'INSTANCE') return null;
  if (n.children.some((c) => isRow(c, row) || (inMargin(c) && isRow(inMargin(c), row)))) return path;
  for (let i = 0; i < n.children.length; i++) { const p = rowsPath(n.children[i], row, path.concat(i)); if (p) return p; }
  return null;
}
function listSpec(rep, row) {
  const path = rowsPath(rep, row, []);
  if (!path) return null;
  const box = nodeAt(rep, path), k = box.children;
  let a = k.findIndex((c) => isItem(c, row)), b = k.length - 1;
  // layers placed on their own after the last row (the bars and marks a capture lifted out of a
  // timeline's rows) are the list's data, not its chrome: they travel in the slot, each screen
  // with its own positions, instead of staying in the main where its representative drew them
  while (b > a && !isItem(k[b], row) && k[b].layoutPositioning !== 'ABSOLUTE') b--;
  return { path, pre: a, post: k.length - 1 - b, list: true };
}
// members: every occurrence of the variant; the slot goes where their children stop matching
function containerSpec(members) { return strict(() => containerSpec0(members)); }
function containerSpec0(members) {
  let path = [], parents = members.slice();
  for (let depth = 0; depth < 8; depth++) {
    const R = parents[0];
    if (!('children' in R) || R.type === 'INSTANCE') return null;
    const len = R.children.length;
    let pre = 0, post = 0;
    while (pre < len && parents.every((p) => p.children.length > pre && same(p.children[pre], R.children[pre]))) pre++;
    while (post < len - pre && parents.every((p) => p.children.length - post - 1 >= pre && same(p.children[p.children.length - post - 1], R.children[len - post - 1]))) post++;
    const whole = parents.every((p) => p.children.length === pre + post);
    if (whole) return null;                         // the same everywhere: no slot, only overrides
    // the one part that changes is a plain frame in every occurrence: look inside it
    const mids = parents.map((p) => p.children.length - pre - post === 1 ? p.children[pre] : null);
    if (mids.every((m) => m && m.type === 'FRAME' && partKey(m) === partKey(mids[0]) && m.children.length && m.layoutMode !== 'GRID')) {
      path = path.concat(pre); parents = mids; continue;
    }
    return { path, pre, post };
  }
  return null;
}
// where a layer placed on its own sits in its parent, from the edge it is nearest to in the rep
// (a badge pinned to the right of a wider cell has not moved)
function fromEdge(n, horizontal, far) {
  if (!horizontal) return far ? n.parent.height - n.y - n.height : n.y;
  return far ? n.parent.width - n.x - n.width : n.x;
}
// a's absolutely placed descendants stand where b's do (within 2 px). An instance never takes
// positions from its occurrence: a part whose layers move from line to line (a timeline's marks,
// a bar that starts on another day) has to be content, or every line shows the rep's
function samePlace(a, b) {
  if (a.type === 'INSTANCE' || !('children' in a) || !('children' in b)) return true;
  // other free layers than the rep's (a mark where the rep has a bar and its hue) can't stand where
  // the rep's do: an instance would keep the rep's, sized and placed as the rep drew them
  if (a.children.length !== b.children.length) {
    const free = (n) => n.children.some((c) => c.layoutPositioning === 'ABSOLUTE');
    return !free(a) && !free(b);
  }
  return a.children.every((c, i) => {
    const d = b.children[i];
    if (c.layoutPositioning === 'ABSOLUTE' && d.layoutPositioning === 'ABSOLUTE') {
      for (const h of [true, false]) {
        const far = fromEdge(d, h, true) < fromEdge(d, h, false);
        if (Math.abs(fromEdge(c, h, far) - fromEdge(d, h, far)) > 2) return false;
      }
    }
    return samePlace(c, d);
  });
}
// a row whose cells hold different things on every line (a chip here, a dash there): the row
// keeps its cells — the same count and kind everywhere — and each cell that changes is a slot.
// One variant instead of dozens, and editing the row still edits every row. A cell whose layers
// placed on their own move from line to line changes too
function cellSpec(members) {
  const R = members[0];
  if (!('children' in R) || R.children.length < 2 || R.type === 'INSTANCE') return null;
  const n = R.children.length;
  if (!members.every((m) => 'children' in m && m.children.length === n && m.children.every((c, i) => partKey(c) === partKey(R.children[i])))) return null;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const c = R.children[i];
    const fixed = members.every((m) => same(m.children[i], c));
    if (fixed && members.every((m) => samePlace(m.children[i], c))) continue;
    // a cell that can't be a slot (a grid, a shape) stays fixed when only its free layers move: the
    // row keeps a spec for its other cells. One whose parts change can't be a cell at all
    if (c.type !== 'FRAME' || c.layoutMode === 'GRID') { if (fixed) continue; return null; }
    cells.push(i);
  }
  return cells.length ? { cells } : null;
}
// the occurrence's side of a spec: the content that goes into the slot
function slotRange(o, spec) {
  const p = nodeAt(o, spec.path);
  if (!p || !('children' in p)) return null;
  const k = p.children;
  if (k.length < spec.pre + spec.post) return null;
  return k.slice(spec.pre, k.length - spec.post);
}
// the chrome (all but the slot range) of o is the same as the main's, on the same declared columns:
// the builder groups by them, so a row of 330 px labels never lands on the 240 px variant (its
// label's fixed height stays with it: a swapped nested instance can't be resized)
function chromeFits(o, main, spec) { return sameCols(o, main) && strict(() => (spec.cells ? cellsFit(o, main, spec) : chromeFits0(o, main, spec))); }
function cellsFit(o, main, spec) {
  if (!('children' in o) || o.children.length !== main.children.length) return false;
  return o.children.every((c, i) => (spec.cells.includes(i) ? partKey(c) === (U(main.children[i], 'cellKey') || partKey(main.children[i])) : same(c, main.children[i])));
}
function chromeFits0(o, main, spec) {
  let a = o, b = main;
  for (let d = 0; d <= spec.path.length; d++) {
    // the slot frame took its property's name when it was bound: its own name no longer counts
    if (!a || !b || (d > 0 && !(d === spec.path.length && !spec.wrap) && partKey(a) !== partKey(b))) return false;
    if (!('children' in a)) return false;
    const last = d === spec.path.length;
    const pre = last ? spec.pre : spec.path[d];
    const bk = last && spec.wrap ? b.children.filter((c) => !U(c, 'slotWrap')) : b.children;
    const post = last ? spec.post : bk.length - pre - 1;
    if (a.children.length < pre + post + (last ? 0 : 1)) return false;
    for (let i = 0; i < pre; i++) if (!same(a.children[i], bk[i])) return false;
    for (let i = 1; i <= post; i++) if (!same(a.children[a.children.length - i], bk[bk.length - i])) return false;
    if (last) return spec.list ? runFits(a, b, spec) : gridAlike(a, b);
    if (a.children.length - pre - post !== 1) return false;
    a = a.children[pre]; b = bk[pre];
  }
  return true;
}

// ---- responsive ----------------------------------------------------------------------------
// ---- shared by the builder and the swap ---------------------------------------------------
const LAYOUT_KEYS = ['layoutPositioning', 'layoutAlign', 'layoutGrow', 'gridChildHorizontalAlign', 'gridChildVerticalAlign'];
// a grid's tracks beyond its last cell (a capture's auto-fill leftovers, a phantom row) go
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
// a child into its grid cell {r, c, rs, cs}: the anchor first, at one cell, then the spans. A
// span set first is checked against the cell the auto-flow happened to give the child (two
// columns from the second column of two throws, and the move never runs). Tracks the cell needs
// are added; the caller trims what is left over. Throws when the grid can't give the cell
function toCell(n, cell) {
  const g = n.parent;
  n.gridRowSpan = 1; n.gridColumnSpan = 1;
  if (g.gridRowCount < cell.r + cell.rs) g.gridRowCount = cell.r + cell.rs;
  if (g.gridColumnCount < cell.c + cell.cs) g.gridColumnCount = cell.c + cell.cs;
  n.setGridChildPosition(cell.r, cell.c);
  n.gridRowSpan = cell.rs; n.gridColumnSpan = cell.cs;
}
// a cell that wraps keeps a hair less than its width: three cells of 144.7 and two gaps of 14
// measure 462.1 in a 462 px row, and the third would drop to the next line
const wrapWidth = (w) => Math.max(1, Math.floor(w * 10) / 10 - 0.1);
// the room between grid cells as drawn (kids in row, then column order): a capture's grid gap can
// be a couple of px off the cells it laid out, and two px decide whether three cards fit a line
function measuredGaps(kids, colGap, rowGap) {
  const cg = [], rg = [];
  for (let i = 1; i < kids.length; i++) {
    const a = kids[i - 1], b = kids[i];
    try {
      if (a.gridRowAnchorIndex === b.gridRowAnchorIndex) cg.push(b.x - (a.x + a.width));
      else rg.push(b.y - (a.y + a.height));
    } catch (e) {}
  }
  const med = (l) => (l.length ? l.slice().sort((p, q) => p - q)[Math.floor(l.length / 2)] : null);
  const c = med(cg), r = med(rg);
  const ok = (v, d) => (v !== null && v >= 0 && v < 200 ? Math.round(v * 10) / 10 : d || 0);
  return { col: ok(c, colGap), row: ok(r, rowGap === undefined ? ok(c, colGap) : rowGap) };
}
// a box's own room and alignment travel as overrides (a section padded 15 here and 1 there, a
// header whose count fell under its title aligns its lines at the start), and so do a grid's
// fixed tracks and gaps as its page drew them (a label column 330 px on one screen and 240 on
// another: the stylesheet's variable, not another structure). Tracks that grow or fit their
// content stay the main's
function copyLayout(a, d) {
  if (!('layoutMode' in a) || !('layoutMode' in d) || a.layoutMode === 'NONE' || a.layoutMode !== d.layoutMode) return 0;
  let n = 0;
  for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing', 'primaryAxisAlignItems', 'counterAxisAlignItems']) {
    try { if (k in a && k in d && a[k] !== d[k] && a[k] !== figma.mixed) { d[k] = a[k]; n++; } } catch (e) {}
  }
  if (a.layoutMode !== 'GRID') return n;
  for (const k of ['gridColumnSizes', 'gridRowSizes']) {
    try {
      const ta = a[k], td = d[k];
      if (ta.length !== td.length) continue;
      let diff = false;
      const out = td.map((x, i) => {
        if (x.type !== 'FIXED' || ta[i].type !== 'FIXED' || Math.abs(ta[i].value - x.value) <= 0.5) return x;
        diff = true;
        return { type: 'FIXED', value: ta[i].value };
      });
      if (diff) { d[k] = out; n++; }
    } catch (e) {}
  }
  for (const k of ['gridColumnGap', 'gridRowGap']) { try { if (k in a && k in d && a[k] !== d[k]) { d[k] = a[k]; n++; } } catch (e) {} }
  return n;
}
/*@build*/
// the tracks the stylesheet declared (read-tags: gc/gr), as Figma grid tracks: f<n> flexible,
// x<px> fixed, h (auto) fits its content — unless no track of that axis is flexible: then the
// browser stretched the auto tracks over the free space (a 34 px header's only row is 34 px), and
// they share it like flexible ones, in the proportions they had. Null when the capture carried no
// template or the count differs
function declaredTracks(f, axis, count) {
  const code = U(f, axis === 'c' ? 'gc' : 'gr');
  if (!code) return null;
  const t = code === '*h' ? Array.from({ length: count }, () => 'h') : code.split(',');
  if (t.length !== count) return null;
  let px = null; try { px = (axis === 'c' ? f.gridColumnSizes : f.gridRowSizes).map((s) => s.value || 0); } catch (e) {}
  const anyFlex = t.some((x) => x[0] === 'f');
  const base = px ? Math.max(1, Math.min(...px.filter((v, i) => t[i] === 'h' && v > 0).concat([Infinity]))) : 1;
  return t.map((x, i) => {
    if (x[0] === 'f') return { type: 'FLEX', value: +x.slice(1) || 1 };
    if (x === 'h') return anyFlex || !px ? { type: 'HUG' } : { type: 'FLEX', value: Math.max(0.25, Math.round(px[i] / (isFinite(base) ? base : 1) * 4) / 4) };
    return { type: 'FIXED', value: px ? px[i] : +x.slice(1) || 1 };
  });
}
// a grid is an auto layout frame when it can be one (the capture makes a grid of every CSS grid,
// with every track in px): a slot can't be a grid, and auto layout resizes the way the CSS did.
// One row or one column: a row or a column. Equal columns of single cells (cards four by four):
// a row that wraps. The frame keeps the size the page gave it; the tracks the stylesheet declared
// say which cell grows (1fr → fills) and which fits its content (auto → hugs)
function unGrid(f) {
  if (!f || f.layoutMode !== 'GRID') return false;
  trimGrid(f);
  let rows, cols;
  try { rows = f.gridRowCount; cols = f.gridColumnCount; } catch (e) { return false; }
  SET(f, 'gsig', gridSig(f));
  const all = f.children.filter((c) => c.layoutPositioning !== 'ABSOLUTE');
  const size = [f.width, f.height];
  const decl0 = declaredTracks(f, 'c', cols);
  let single = true; try { single = all.every((c) => c.gridRowSpan === 1 && c.gridColumnSpan === 1); } catch (e) { single = false; }
  const w0 = all.length ? all[0].width : 0;
  const equal = all.length > 1 && all.every((c) => Math.abs(c.width - w0) <= 1);
  // equal cells (cards, tiles, fields) wrap: as many per line as fit, at the width the page gave
  // them. One line wraps the same way, so a main built from one line takes two-line occurrences
  if (single && equal && cols > 1 && (rows > 1 || !decl0)) {
    const kids = all.slice().sort((a, b) => a.gridRowAnchorIndex - b.gridRowAnchorIndex || a.gridColumnAnchorIndex - b.gridColumnAnchorIndex);
    const gaps = measuredGaps(kids, f.gridColumnGap || 0, f.gridRowGap || 0);
    f.layoutMode = 'HORIZONTAL';
    f.layoutWrap = 'WRAP';
    f.itemSpacing = gaps.col; f.counterAxisSpacing = gaps.row;
    try { f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED'; f.resize(size[0], size[1]); } catch (e) {}
    kids.forEach((c, i) => { f.insertChild(i, c); });
    for (const c of kids) {
      try { c.layoutSizingHorizontal = 'FIXED'; c.resize(wrapWidth(w0), c.height); } catch (e) {}
      try { if (c.layoutSizingVertical === 'FILL') c.layoutSizingVertical = canHug(c) ? 'HUG' : 'FIXED'; } catch (e) {}
    }
    return true;
  }
  if (rows > 1 && cols > 1) return false;
  const vertical = cols === 1;
  const gap = vertical ? f.gridRowGap : f.gridColumnGap;
  let tracks = null; try { tracks = vertical ? f.gridRowSizes : f.gridColumnSizes; } catch (e) {}
  const decl = vertical ? declaredTracks(f, 'r', rows) : decl0;
  const kids = all.map((c) => ({ c, at: vertical ? c.gridRowAnchorIndex : c.gridColumnAnchorIndex, w: c.width, h: c.height }))
    .sort((a, b) => a.at - b.at);
  const typeAt = (i) => (decl ? decl[i] : tracks && tracks[i]) || null;
  // the cross-axis alignment the cells had (a toolbar's tabs were centered in their row); a cell as
  // tall as the line (a header's title block) sits the same way under any alignment and doesn't vote
  const inner = vertical ? f.width - f.paddingLeft - f.paddingRight : f.height - f.paddingTop - f.paddingBottom;
  const voters = kids.filter((k) => (vertical ? k.w : k.h) < inner - 1);
  const al = (voters.length ? voters : kids).map((k) => (vertical ? k.c.gridChildHorizontalAlign : k.c.gridChildVerticalAlign));
  const cross = al.length && al.every((a) => a === 'CENTER') ? 'CENTER' : al.length && al.every((a) => a === 'MAX') ? 'MAX' : 'MIN';
  f.layoutMode = vertical ? 'VERTICAL' : 'HORIZONTAL';
  f.itemSpacing = gap || 0;
  try { f.counterAxisAlignItems = cross; } catch (e) {}
  // the page gave the frame its size: the change of layout keeps it (whether it hugs is decided later)
  try { f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED'; f.resize(size[0], size[1]); } catch (e) {}
  kids.forEach((k, i) => { f.insertChild(i, k.c); });
  for (const k of kids) {
    try {
      if (vertical) { k.c.layoutSizingHorizontal = Math.abs(k.w - (f.width - f.paddingLeft - f.paddingRight)) < 2 ? 'FILL' : 'FIXED'; }
      else { k.c.layoutSizingVertical = Math.abs(k.h - (f.height - f.paddingTop - f.paddingBottom)) < 2 ? 'FILL' : 'FIXED'; }
      const t = typeAt(k.at), key = vertical ? 'layoutSizingVertical' : 'layoutSizingHorizontal';
      // a flexible track (fr) becomes a child that fills along the new direction; an auto track one that hugs
      if (t && t.type === 'FLEX') k.c[key] = 'FILL';
      else if (t && t.type === 'HUG' && canHug(k.c)) k.c[key] = 'HUG';
    } catch (e) {}
  }
  return true;
}
// a hidden part keeps its grid track, and a hugging track left empty even takes a share of the free
// room (a header's title shrank to half its width when its second button was off). A one-row or
// one-column grid holding a part some screens hide becomes the auto layout it stands for, where a
// hidden layer takes no room. What the live tracks say is kept: a flexible track fills, a fixed one
// keeps its px, a hugging one keeps its cell's own sizing (an avatar stays 32 px, it doesn't hug
// its initials). Left as a grid: a flexible track holding the part (a table's columns must stay
// aligned across rows) and flexible tracks of different weights (no auto layout twin)
function flowOptional(P, part) {
  if (!P || P.type === 'INSTANCE' || P.layoutMode !== 'GRID' || part.layoutPositioning === 'ABSOLUTE') return false;
  let H, tracks, gap, order;
  try {
    const rows = P.gridRowCount, cols = P.gridColumnCount;
    if ((rows > 1 && cols > 1) || rows * cols < 2) return false;
    H = rows === 1;
    tracks = H ? P.gridColumnSizes : P.gridRowSizes;
    gap = H ? P.gridColumnGap : P.gridRowGap;
    const at = (c) => (H ? c.gridColumnAnchorIndex : c.gridRowAnchorIndex);
    const t = tracks[at(part)];
    if (!t || t.type === 'FLEX') return false;
    const flex = tracks.filter((x) => x.type === 'FLEX');
    if (flex.some((x) => x.value !== flex[0].value)) return false;
    const kids = P.children.filter((c) => c.layoutPositioning !== 'ABSOLUTE');
    if (kids.some((c) => (H ? c.gridColumnSpan : c.gridRowSpan) !== 1)) return false;
    order = kids.slice().sort((a, b) => at(a) - at(b));
    if (order.length !== tracks.length || order.some((c, i) => at(c) !== i)) return false;
  } catch (e) { return false; }
  const inner = H ? P.height - P.paddingTop - P.paddingBottom : P.width - P.paddingLeft - P.paddingRight;
  const snap = order.map((c) => ({ c, sh: c.layoutSizingHorizontal, sv: c.layoutSizingVertical, w: c.width, h: c.height, al: H ? c.gridChildVerticalAlign : c.gridChildHorizontalAlign }));
  // one alignment across the line; a cell as tall as the line sits the same under any and doesn't vote
  const voters = snap.filter((k) => (H ? k.h : k.w) < inner - 1);
  const al = (voters.length ? voters : snap).map((k) => k.al);
  const cross = al.length && al.every((a) => a === 'CENTER') ? 'CENTER' : al.length && al.every((a) => a === 'MAX') ? 'MAX' : 'MIN';
  const psh = P.layoutSizingHorizontal, psv = P.layoutSizingVertical, size = [P.width, P.height];
  SET(P, 'gsig', gridSig(P));
  const all = P.children.slice();
  let q = 0;
  const want = all.map((c) => (c.layoutPositioning === 'ABSOLUTE' ? c : order[q++]));
  P.layoutMode = H ? 'HORIZONTAL' : 'VERTICAL';
  P.itemSpacing = gap || 0;
  try { P.counterAxisAlignItems = cross; } catch (e) {}
  want.forEach((c, j) => { P.insertChild(j, c); });
  try { P.layoutSizingHorizontal = 'FIXED'; P.layoutSizingVertical = 'FIXED'; P.resize(size[0], size[1]); } catch (e) {}
  for (const [k, v] of [['layoutSizingHorizontal', psh], ['layoutSizingVertical', psv]]) if (v !== 'FIXED') { try { P[k] = v; } catch (e) {} }
  const mainK = H ? 'layoutSizingHorizontal' : 'layoutSizingVertical', crossK = H ? 'layoutSizingVertical' : 'layoutSizingHorizontal';
  const crossHugs = P[crossK] === 'HUG';
  snap.forEach((k, i) => {
    const c = k.c, t = tracks[i];
    const was = { layoutSizingHorizontal: k.sh, layoutSizingVertical: k.sv };
    let mainTo = was[mainK], mainLen = H ? k.w : k.h;
    if (t.type === 'FLEX') mainTo = 'FILL';
    else if (mainTo === 'FILL') { if (t.type === 'FIXED') { mainTo = 'FIXED'; mainLen = t.value; } else mainTo = canHug(c) ? 'HUG' : 'FIXED'; }
    let crossTo = was[crossK];
    if (crossTo === 'FILL' && crossHugs) crossTo = canHug(c) ? 'HUG' : 'FIXED';
    try {
      c.layoutSizingHorizontal = 'FIXED'; c.layoutSizingVertical = 'FIXED';
      c.resize(H ? mainLen : k.w, H ? k.h : mainLen);
      if (mainTo !== 'FIXED') c[mainK] = mainTo;
      if (crossTo !== 'FIXED') c[crossK] = crossTo;
    } catch (e) {}
  });
  SET(P, 'flowed', '1');
  return true;
}

/*@end*/
/*@swap*/
// ---- overrides ----------------------------------------------------------------------------
// o's content onto inst, part by part through the map o → main; main parts o doesn't have are
// hidden (with their boolean property when they have one)
async function copyInto(o, inst, main, bools) {
  const map = mapInto(o, main, new Map());
  // main node → instance node: the instance mirrors the main, walk both
  const twin = new Map();
  const pair = (m, i) => { twin.set(m, i); if ('children' in m && m.type !== 'INSTANCE' && 'children' in i) m.children.forEach((c, k) => i.children[k] && pair(c, i.children[k])); };
  pair(main, inst);
  let n = 0;
  const hit = new Set(map.values());
  for (const [a, b] of map) {
    const d = twin.get(b);
    if (d) n += await copyShallow(a, d, a === o);
  }
  const props = {}, hide = [];
  for (const [b, d] of twin) {
    if (hit.has(b) || b === main || !d.visible) continue;
    // hide the outermost missing part only
    let p = b.parent, covered = false;
    while (p && p !== main) { if (!hit.has(p)) { covered = true; break; } p = p.parent; }
    if (covered) continue;
    const key = bools && bools[b.id];
    if (key) props[key] = false; else hide.push(d);
    n++;
  }
  if (Object.keys(props).length) {
    try { inst.setProperties(props); } catch (e) { for (const [b, d] of twin) if (bools && bools[b.id] in props) hide.push(d); }
  }
  for (const d of hide) d.visible = false;
  return n;
}
// one part: its text, its paints, its swap (an instance also takes its own nested overrides)
async function copyShallow(a, d, root) {
  if (a.type === 'INSTANCE' && d.type === 'INSTANCE') { try { return await copyOverrides(a, d, null, false); } catch (e) { return 0; } }
  let n = 0;
  if (a.type === 'TEXT' && d.type === 'TEXT') n += await copyText(a, d);
  for (const k of ['fills', 'strokes', 'effects']) {
    try { if (k in a && k in d && a[k] !== figma.mixed && !eq(a[k], d[k])) { d[k] = a[k]; n++; } } catch (e) {}
  }
  // a border drawn on some sides (a row's top rule) keeps its sides: the paint alone took the
  // main's uniform weight and boxed every row in
  if (Array.isArray(a.strokes) && a.strokes.length && 'strokeTopWeight' in a && 'strokeTopWeight' in d) {
    for (const k of ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight', 'strokeAlign']) {
      try { if (a[k] !== figma.mixed && a[k] !== d[k]) { d[k] = a[k]; n++; } } catch (e) {}
    }
  }
  n += copyLayout(a, d);
  if (!root) for (const k of ['visible', 'opacity']) { try { if (k in a && a[k] !== d[k]) { d[k] = a[k]; n++; } } catch (e) {} }
  return n;
}

const LIMITS = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'];
// o's box as the page drew it. Read BEFORE anything leaves o: a frame that hugs shrinks as its
// rows go, and an auto layout frame left empty keeps the size of the last row that left
function boxOf(o) {
  const keep = {};
  for (const k of LAYOUT_KEYS.concat(['layoutSizingHorizontal', 'layoutSizingVertical', 'x', 'y', 'width', 'height', 'constraints'], LIMITS)) if (k in o) keep[k] = o[k];
  keep.grid = o.parent.layoutMode === 'GRID' ? { r: o.gridRowAnchorIndex, c: o.gridColumnAnchorIndex, rs: o.gridRowSpan, cs: o.gridColumnSpan } : null;
  return keep;
}
// one axis to a fixed length. resize() fixes both axes: the other one keeps hugging if it did
function fixAxis(n, horizontal, len) {
  const other = horizontal ? 'layoutSizingVertical' : 'layoutSizingHorizontal', was = n[other];
  n[horizontal ? 'layoutSizingHorizontal' : 'layoutSizingVertical'] = 'FIXED';
  n.resize(horizontal ? Math.max(len, 0.01) : n.width, horizontal ? n.height : Math.max(len, 0.01));
  if (was === 'HUG' && n[other] !== 'HUG') n[other] = 'HUG';
}
// instances the grid could not put in their occurrence's cell (the swap reports their ids)
const gridMisses = [];
// the occurrence leaves first: in a grid it holds its cell, and inserting next to it makes the
// auto-flow open a new row that stretches the grid.
// hug {h, v, vBox}: the axes that follow the instance's content (its slot's rows), vBox when the
// height hugs only because the page's box did; keep: boxOf(o), taken before the slot content moved
function place(o, inst, hug, keep = boxOf(o)) {
  const parent = o.parent, idx = parent.children.indexOf(o);
  const auto = 'layoutMode' in parent && parent.layoutMode !== 'NONE';
  const grid = keep.grid;
  const data = {};
  for (const k of ['link', 'label', 'scroll']) data[k] = U(o, k);
  const clip = o.clipsContent, over = o.overflowDirection;
  // an axis that scrolls keeps the length the page gave it, whatever its content
  const hugH = !!hug.h && !/x/.test(data.scroll || ''), hugV = !!hug.v && !/y/.test(data.scroll || '');
  o.remove();
  parent.insertChild(Math.min(idx, parent.children.length), inst);
  if (auto) for (const k of LAYOUT_KEYS) if (k in keep && k in inst) { try { inst[k] = keep[k]; } catch (e) {} }
  if (!auto || keep.layoutPositioning === 'ABSOLUTE') { inst.x = keep.x; inst.y = keep.y; }
  // the occurrence's own limits, none included: a max width the main kept from its representative
  // (a note capped at 72ch) would clamp an occurrence the page let run wider
  for (const k of LIMITS) if (k in keep && k in inst && inst[k] !== keep[k]) { try { inst[k] = keep[k]; } catch (e) {} }
  if (Math.abs(inst.width - keep.width) > 0.5 || Math.abs(inst.height - keep.height) > 0.5) inst.resize(Math.max(keep.width, 0.01), Math.max(keep.height, 0.01));
  for (const k of ['layoutSizingHorizontal', 'layoutSizingVertical']) {
    if (!auto || !(k in keep)) continue;
    // filling a parent that hugs that axis would collapse the instance: it keeps its measured length
    const want = keep[k] === 'FILL' && hugsAxis(parent, k === 'layoutSizingHorizontal') ? 'FIXED' : keep[k];
    try { inst[k] = want; } catch (e) {}
  }
  if (hugV) { try { inst.layoutSizingVertical = 'HUG'; } catch (e) {} }
  // a width that fills its parent stays filling; in a free frame nothing checks a hugging width
  // against the page (below), so there it keeps the drawn one
  if (hugH && auto && inst.layoutSizingHorizontal !== 'FILL') { try { inst.layoutSizingHorizontal = 'HUG'; } catch (e) {} }
  // the instance ends the size the page drew: a sizing mode that changed it (a hug that shrank a
  // 26 px button to its 21 px text) gives way to a fixed size; what fills stays with its parent.
  // A width the page sized by its content keeps hugging within 4 px of it (text widths drift a
  // little per row, and add up along a tab bar); one that hugs only because its main does, within
  // half a pixel (the page drew it fixed: a grid cell, a declared width)
  if (auto) {
    const tolH = keep.layoutSizingHorizontal === 'HUG' ? 4 : 0.5;
    const hugsNear = hugH && inst.layoutSizingHorizontal === 'HUG' && Math.abs(inst.width - keep.width) <= tolH;
    if (!hugsNear && inst.layoutSizingHorizontal !== 'FILL' && Math.abs(inst.width - keep.width) > 0.5) { try { fixAxis(inst, true, keep.width); } catch (e) {} }
    if (!hugV && inst.layoutSizingVertical !== 'FILL' && Math.abs(inst.height - keep.height) > 0.5) { try { fixAxis(inst, false, keep.height); } catch (e) {} }
    // a height that hugs only because the page's box did (its main has a height of its own) keeps
    // the page's beyond half a pixel: heights stack down a column, and one row's drift moves every
    // row under it
    if (hugV && hug.vBox && inst.layoutSizingVertical === 'HUG' && Math.abs(inst.height - keep.height) > 0.5) { try { fixAxis(inst, false, keep.height); } catch (e) {} }
  }
  // the page stretched it (align stretch in a row of cards, a grid cell): a hugging main ends
  // shorter than the browser drew it. It fills a row that has a height of its own (a row that hugs
  // would shrink it to its siblings, as above), or keeps the drawn height
  if (hugV && auto && inst.layoutSizingVertical === 'HUG' && keep.height - inst.height > 2) {
    try {
      if (parent.layoutMode === 'GRID' || (parent.layoutMode === 'HORIZONTAL' && !hugsAxis(parent, false))) inst.layoutSizingVertical = 'FILL';
      else fixAxis(inst, false, keep.height);
    } catch (e) {}
  }
  if (keep.constraints) { try { inst.constraints = keep.constraints; } catch (e) {} }
  for (const k in data) if (data[k]) SET(inst, k, data[k]);
  if (data.scroll) { try { inst.clipsContent = true; inst.overflowDirection = over; } catch (e) {} }
  else if (clip !== undefined && clip !== inst.clipsContent) { try { inst.clipsContent = clip; } catch (e) {} }
  if (grid) {
    try { toCell(inst, grid); } catch (e) { gridWarnings++; }
    // a cell the grid couldn't give (a sibling holds it): the instance stays where the auto-flow
    // put it, and its id is reported instead of a bare count
    let at = null;
    try { at = [inst.gridRowAnchorIndex, inst.gridColumnAnchorIndex, inst.gridRowSpan, inst.gridColumnSpan].join(); } catch (e) {}
    if (at !== [grid.r, grid.c, grid.rs, grid.cs].join()) gridMisses.push(inst.id);
    trimGrid(parent);
  }
}

// the room between o's rows (range, in the rows box P) as its page laid them out, read before
// they move: the main's slot has its representative's (a side panel's cards sat 8 apart, the
// main's 14 came from a wider group, and the third card no longer fit the line)
function runGaps(P, range) {
  if (!P || !('layoutMode' in P)) return null;
  const mode = P.layoutMode, align = P.counterAxisAlignItems;
  const num = (v) => (typeof v === 'number' ? v : null);
  if (mode === 'HORIZONTAL') return { mode, align, col: num(P.itemSpacing), row: P.layoutWrap === 'WRAP' ? num(P.counterAxisSpacing) : null };
  if (mode === 'VERTICAL') return { mode, align, col: null, row: num(P.itemSpacing) };
  if (mode !== 'GRID') return null;
  let kids;
  try { kids = range.filter((c) => c.layoutPositioning !== 'ABSOLUTE').sort((a, b) => a.gridRowAnchorIndex - b.gridRowAnchorIndex || a.gridColumnAnchorIndex - b.gridColumnAnchorIndex); } catch (e) { return null; }
  return Object.assign({ mode, align: null }, measuredGaps(kids, P.gridColumnGap || 0, P.gridRowGap || 0));
}
// a slot frame takes the occurrence's room between rows (runGaps) where it differs, and its cross
// alignment when both run the same way
function slotGaps(s, g) {
  const set = (k, v) => { if (v !== null && !(typeof s[k] === 'number' && Math.abs(s[k] - v) <= 0.5)) { try { s[k] = v; } catch (e) {} } };
  if (s.layoutMode === 'HORIZONTAL') { set('itemSpacing', g.col); if (s.layoutWrap === 'WRAP') set('counterAxisSpacing', g.row); }
  else if (s.layoutMode === 'VERTICAL') set('itemSpacing', g.row);
  if (g.align && g.mode === s.layoutMode && s.counterAxisAlignItems !== g.align) { try { s.counterAxisAlignItems = g.align; } catch (e) {} }
}
// moves the occurrence's slot content into the instance's slot, sizes kept. Every size is read
// before anything moves: children that share a row (flex: 1) re-flow as their siblings leave.
// gaps: the occurrence's room between its rows (runGaps), when it has rows
function fillSlot(inst, spec, range, gaps) {
  const s = nodeAt(inst, spec.slotPath);
  if (!s || !('children' in s)) return false;
  for (const c of [...s.children]) c.remove();
  // an empty slot keeps a placeholder size in an instance: it is hidden instead
  if (!range.length) { s.visible = false; return true; }
  // a layer placed on its own (a bar over a timeline) keeps where it stood in its box: it lands
  // in the slot, which can sit inset in the instance's twin of that box (a border counted in the
  // layout put a canvas's slot at 1,1), so its place is measured from the box, not the slot
  const at = (n) => [n.absoluteTransform[0][2], n.absoluteTransform[1][2]];
  const snap = range.map((c) => {
    const k = { c, h: c.layoutSizingHorizontal, v: c.layoutSizingVertical, w: c.width, hh: c.height };
    if (c.layoutPositioning === 'ABSOLUTE') { const p = at(c), q = at(c.parent); k.rel = [p[0] - q[0], p[1] - q[1]]; }
    return k;
  });
  const horizontal = s.layoutMode === 'HORIZONTAL';
  const hugsAlong = horizontal ? s.layoutSizingHorizontal === 'HUG' || s.primaryAxisSizingMode === 'AUTO' && s.layoutSizingHorizontal !== 'FILL' : s.primaryAxisSizingMode === 'AUTO';
  const hugsAcross = hugsAxis(s, !horizontal);
  const wrap = s.layoutWrap === 'WRAP';
  // a slot that spans grid tracks sizes its children as the tracks did (1fr fills, auto hugs, px
  // stays), one track per child in the flow. It keeps the grid's gap: the room measured between
  // its cells holds each track's free space too
  const flow = snap.filter((k) => !k.rel);
  let kinds = null; try { kinds = JSON.parse(U(s, 'kinds') || 'null'); } catch (e) {}
  if (gaps && kinds === null) slotGaps(s, gaps);
  if (!Array.isArray(kinds) || kinds.length !== flow.length) kinds = null;
  let i = -1;
  for (const k of snap) {
    const c = k.c;
    s.appendChild(c);
    // re-parenting can drop the absolute positioning: a free layer back in the flow would stack
    // under the rows, move the slot measured below, and ignore the x/y it gets at the end
    if (k.rel) { if (s.layoutMode !== 'NONE') { try { c.layoutPositioning = 'ABSOLUTE'; } catch (e) {} } continue; }
    i++;
    for (const ax of ['h', 'v']) {
      const key = ax === 'h' ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
      let want = k[ax];
      // in a slot that hugs its content, a child that grew to share a fixed length keeps that length
      if (want === 'FILL' && ((ax === 'h') === horizontal ? hugsAlong : hugsAcross)) want = 'FIXED';
      // cells that wrap keep the width the page gave them: a filling cell pulls the line into one row
      if (wrap && ax === 'h') want = 'FIXED';
      if (kinds && (ax === 'h') === horizontal) want = kinds[i] === 'FLEX' ? 'FILL' : kinds[i] === 'HUG' && canHug(c) ? 'HUG' : 'FIXED';
      try { if (want) c[key] = want; } catch (e) { try { c[key] = 'FIXED'; } catch (e2) {} }
    }
    if (c.layoutSizingHorizontal === 'FIXED' || c.layoutSizingVertical === 'FIXED') {
      try { c.resize(c.layoutSizingHorizontal === 'FIXED' ? (wrap ? wrapWidth(k.w) : k.w) : c.width, c.layoutSizingVertical === 'FIXED' ? k.hh : c.height); } catch (e) {}
    }
    if (hugsAlong) { try { c.layoutGrow = 0; } catch (e) {} }
  }
  // the free layers last: the rows have settled the slot where it stands in the box
  const home = nodeAt(inst, spec.path || spec.slotPath);
  const off = home ? [at(s)[0] - at(home)[0], at(s)[1] - at(home)[1]] : [0, 0];
  for (const k of snap) if (k.rel) { try { k.c.x = k.rel[0] - off[0]; k.c.y = k.rel[1] - off[1]; } catch (e) {} }
  return true;
}
/*@end*/
/*@swap*/
// each changing cell's content into its slot on the instance
function fillCells(o, inst, spec) {
  for (const i of spec.cells) {
    const src = o.children[i], dst = inst.children[i];
    if (!src || !dst || !('children' in dst)) return false;
    fillSlot(dst, { slotPath: [] }, [...src.children]);
  }
  return true;
}
/*@end*/
const variantName = (props) => props.trim().split(/\s+/).filter(Boolean).join(', ');
