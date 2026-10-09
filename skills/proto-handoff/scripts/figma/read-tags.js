// use_figma script template — reads layer identity from a tagged capture. The capture page ran
// tagForCapture() (contract runtime), so every layer name carries its DOM identity:
//   "Button - [[to:inbox/notice][ui:InboxRow|leading=person unread=yes][wh:474x61.3]] Alex mentioned you…"
// This turns those names into clean layer names plus shared plugin data (ns "uic"):
//   ui, props, slots (component roots) · icon · section · slot · link (target screen id) · scroll ·
//   gc/gr (grid tracks as the stylesheet wrote them: f = flexible, h = fits content, x = fixed) ·
//   fx (a flex box's direction, wrap, gaps, spread and alignment) · pos (out of the flow) ·
//   as (an item that aligns itself across its flex box: c, e, s, st)
// The scrollbar's room comes back as padding first, so every layer compared with its tag sees its
// content at the width the browser gave it.
// A flex box the capture left as free layout (a row that wraps) becomes auto layout again from fx.
// A sticky label the capture left absolute in the box that scrolls goes back into its row, and so
// does a bar or a mark it lifted out of a row. A margin the capture baked into the element's own
// frame as padding moves to a margin wrapper, which goes the way every margin goes. An item that
// aligns itself (align-self) keeps its alignment.
// The capture wraps some elements in frames of its own (the element's margins, an auto margin
// that pushes it to the right, the content of a box that scrolls) and repeats the label on them.
// The size in the tag (wh) says which layer IS the element; the others lose the tags and become
// "margin" (outside it) or "content" (inside it). Margins that are the same between every pair of
// siblings become their parent's gap, so a list holds its rows directly.
// No DOM map upload: it is the same small script for every screen.
// addTags: tags a newer runtime would have written, for captures made before it did (from a scan
// of the same pages): { "<frame id>": { "<ui:Name or n:class>|<wh>": { gut: "10,0", as: "e" } } }.
// They fill only what the layer's own tags lack, so a capture that has them wins.
const PARAMS = /*PARAMS*/ { screens: [], addTags: {} } /*END*/;

const TAG = /^(.*?)\[\[(.*?)\]\]\s*(.*)$/s;
const PH = /^(Sticky placeholder|Placeholder for)\b/;
// the capture's own wrapper for an element's margins, when the element itself became a bare text
const MARGIN = /:margin$/;
const U = (n, k) => n.getSharedPluginData('uic', k);
const SET = (n, k, v) => n.setSharedPluginData('uic', k, v);
const paints = (n) => ['fills', 'strokes', 'effects'].some((k) => k in n && Array.isArray(n[k]) && n[k].some((p) => p.visible !== false));
const parse = (s) => { const t = {}; for (const x of s.split('][')) { const i = x.indexOf(':'); t[x.slice(0, i)] = x.slice(i + 1); } return t; };
const whOf = (t) => { const m = (t.wh || '').match(/^([\d.]+)x([\d.]+)$/); return m ? [+m[1], +m[2]] : null; };
const canHug = (n) => n.type === 'TEXT' || ('layoutMode' in n && n.layoutMode !== 'NONE');
// the room a box keeps for its scrollbars, [right, bottom, left]: gut says it for every box that
// keeps it (scrollbar-gutter keeps it with nothing to scroll; both-edges or a right-to-left box
// keeps some on the left); an older capture says it in the scroll tag, and only for a box that scrolls
function gutterOf(t) {
  const g = (t.gut || (t.scroll || '').split(':')[1] || '').split(',');
  return [0, 1, 2].map((i) => Math.max(0, +g[i] || 0));
}
// the first layer of a label: the layers inside it that repeat the label are its wrappers
const outermost = (n, raw) => !(n.parent && raw.has(n.parent) && raw.get(n.parent).str === raw.get(n).str);

// n and the layers inside it that repeat its label, one inside the other (outermost first)
function chainOf(n, raw) {
  const str = raw.get(n).str, chain = [n];
  for (let c = n; ;) {
    const k = 'children' in c ? c.children.filter((x) => raw.has(x) && raw.get(x).str === str) : [];
    if (k.length !== 1) break;
    c = k[0]; chain.push(c);
  }
  return chain;
}
// the layer that is the element, among the ones that repeat its label (outermost first)
function pickElement(chain, tags) {
  const wh = whOf(tags);
  if (wh) {
    const fit = chain.filter((n) => Math.abs(n.width - wh[0]) <= 1.5 && Math.abs(n.height - wh[1]) <= 1.5);
    if (fit.length === 1) return fit[0];
    if (fit.length > 1) return fit.find(paints) || fit[fit.length - 1];
  }
  // no size (an older capture): a box that scrolls is the outer layer (the inner one holds its
  // scrolled content); a layer that paints nothing around a single layer is a margin
  if (tags.scroll) return chain[0];
  let k = 0;
  while (k < chain.length - 1 && !paints(chain[k]) && chain[k].children.length === 1) k++;
  return chain[k];
}

// ---- grids: a layer that comes in never lands where Figma would put it ------------------------
// a grid parent's row and column counts
const countsOf = (P) => ('layoutMode' in P && P.layoutMode === 'GRID' ? { R: P.gridRowCount, C: P.gridColumnCount } : null);
// where n sits in its grid parent: its cell, spans and alignment (none out of the flow) and the counts
function cellOf(n) {
  const g = n.parent && countsOf(n.parent);
  if (g && n.layoutPositioning !== 'ABSOLUTE') {
    try { Object.assign(g, { r: n.gridRowAnchorIndex, c: n.gridColumnAnchorIndex, rs: n.gridRowSpan, cs: n.gridColumnSpan, ha: n.gridChildHorizontalAlign, va: n.gridChildVerticalAlign }); } catch (e) {}
  }
  return g;
}
// a layer put into a grid lands in its first free cell, or in a row Figma adds when every cell is
// taken: it goes to the cell g recorded (the anchor at one cell first: a span checked against the
// cell Figma picked can throw), and a row or column added on the way goes
function backToCell(n, g) {
  if (g.r !== undefined && n.layoutPositioning !== 'ABSOLUTE') {
    try { n.gridRowSpan = 1; n.gridColumnSpan = 1; n.setGridChildPosition(g.r, g.c); n.gridRowSpan = g.rs; n.gridColumnSpan = g.cs; } catch (e) {}
    try { n.gridChildHorizontalAlign = g.ha; n.gridChildVerticalAlign = g.va; } catch (e) {}
  }
  const P = n.parent;
  try { if (P.gridRowCount > g.R) P.gridRowCount = g.R; if (P.gridColumnCount > g.C) P.gridColumnCount = g.C; } catch (e) {}
}
// W takes n's place and n goes into W. n leaves first, so in a grid W gets the cell n freed.
// Returns the grid record when the place was a grid cell
function takePlace(W, n) {
  const P = n.parent, at = P.children.indexOf(n), g = cellOf(n), abs = n.layoutPositioning === 'ABSOLUTE';
  W.appendChild(n);
  P.insertChild(at, W);
  if (abs) { try { W.layoutPositioning = 'ABSOLUTE'; } catch (e) {} }
  if (g) backToCell(W, g);
  return g;
}

// ---- sticky and absolute layers the capture lifted out of the flow ---------------------------
// how far a sticky layer can sit from its room in the box that scrolls around n: as far as the
// content runs before the box (it had scrolled, and a label pinned at the top or the left stayed)
// or past its end (a label pinned at the bottom or the right waits there for the rest). [0, 0] when
// everything fits, or when nothing around n scrolls. The capture repeats the box's label on its
// margins and on its scrolled content, so every layer of the label is measured: the box can be
// any of them
function scrolledBy(n, raw) {
  let S = n.parent;
  while (S && !(raw.has(S) && raw.get(S).tags.scroll)) S = S.parent;
  if (!S) return [0, 0];
  while (!outermost(S, raw)) S = S.parent;
  let sx = 0, sy = 0;
  for (const L of chainOf(S, raw)) {
    const b = L.absoluteBoundingBox;
    if (!b || !('children' in L)) continue;
    for (const c of L.children) {
      const cb = c.absoluteBoundingBox;
      if (!cb) continue;
      sx = Math.max(sx, b.x - cb.x, cb.x + cb.width - b.x - b.width);
      sy = Math.max(sy, b.y - cb.y, cb.y + cb.height - b.y - b.height);
    }
  }
  return [sx, sy];
}
// a is b or a layer inside b
function inside(a, b) {
  for (; a; a = a.parent) if (a === b) return true;
  return false;
}
// each placeholder's layer: the same label and size, at the same place give or take how far the
// box around it had scrolled (a label pinned to the left of a timeline scrolled to today sits that
// far from its room). Nearest pairs first, each layer once: rows of identical tracks each get their
// own, and a row whose layer the capture never lifted gets none. A layer inside the placeholder
// would go with it, and one around it would have to go inside itself: neither takes its place
function stickyPairs(phs, raw) {
  const pairs = [];
  for (const P of phs) {
    const pb = P.absoluteBoundingBox, str = raw.get(P).str;
    if (!pb) continue;
    const [sx, sy] = scrolledBy(P, raw);
    for (const m of raw.keys()) {
      if (m.layoutPositioning !== 'ABSOLUTE' || raw.get(m).str !== str || PH.test(m.name) || inside(m, P) || inside(P, m)) continue;
      const b = m.absoluteBoundingBox;
      if (!b || Math.abs(b.width - pb.width) > 1.5 || Math.abs(b.height - pb.height) > 1.5) continue;
      const dx = Math.abs(b.x - pb.x), dy = Math.abs(b.y - pb.y);
      if (dx <= 1.5 + sx && dy <= 1.5 + sy) pairs.push({ P, m, d: dx + dy });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  const got = new Map(), used = new Set();
  for (const { P, m } of pairs) if (!got.has(P) && !used.has(m)) { got.set(P, m); used.add(m); }
  return got;
}
// the one in-flow tagged child of P (a component, when ui) whose box holds lb: none when no child
// or several do. Holds: its center, and nearly all of it (a mark of 26 px hangs 2 px under the
// track that positions it); a line across every row is held by none of them
function holderOf(P, L, lb, raw, ui) {
  const holds = (b) => {
    if (!b) return false;
    const cx = lb.x + lb.width / 2, cy = lb.y + lb.height / 2;
    if (cx < b.x - 1 || cx > b.x + b.width + 1 || cy < b.y - 1 || cy > b.y + b.height + 1) return false;
    const ix = Math.min(lb.x + lb.width, b.x + b.width + 1) - Math.max(lb.x, b.x - 1), iy = Math.min(lb.y + lb.height, b.y + b.height + 1) - Math.max(lb.y, b.y - 1);
    return ix > 0 && iy > 0 && ix * iy >= 0.85 * Math.max(lb.width * lb.height, 1);
  };
  const k = P.children.filter((C) => C !== L && 'children' in C && C.layoutPositioning !== 'ABSOLUTE' && raw.has(C) && (!ui || raw.get(C).tags.ui) && holds(C.absoluteBoundingBox));
  return k.length === 1 ? k[0] : null;
}
// L into home at the place it had on screen, still out of the flow. A sticky layer goes first, as
// its row had it; any other paints over the flow, as the browser paints a positioned box. In a grid
// L passes through the flow on its way in, and the row Figma may add for it goes
function rehome(L, home, lb, pos) {
  const hb = home.absoluteBoundingBox, g = countsOf(home);
  if (pos === 's') home.insertChild(0, L); else home.appendChild(L);
  if ('layoutMode' in home && home.layoutMode !== 'NONE') { try { L.layoutPositioning = 'ABSOLUTE'; } catch (e) {} }
  if (g) backToCell(L, g);
  L.x = lb.x - hb.x; L.y = lb.y - hb.y;
}

// ---- margins ----------------------------------------------------------------------------------
// the axis on which the capture baked the element's margin into its frame as padding: the frame is
// bigger than the element there by exactly its padding, and by a pixel at least (the capture
// rounds a box that hugs a text up to the whole pixel, 80 for 79.3, and that is no margin). The
// other axis matches within that rounding, or within a text's measure (3 px) when the frame holds a
// lone text or is the capture's own ':margin' wrapper. The scrollbar's room g ([right, bottom,
// left]) is padding too, but inside the element: it is no margin
function bakedAxis(n, label, wh, g) {
  const dy = n.height - wh[1], dx = n.width - wh[0];
  const padV = n.paddingTop + n.paddingBottom - g[1], padH = n.paddingLeft + n.paddingRight - g[0] - g[2];
  const off = MARGIN.test(label) || (n.children.length === 1 && n.children[0].type === 'TEXT') ? 3 : 1;
  if (dy >= 1 && padV >= 1 && Math.abs(padV - dy) <= 1 && Math.abs(dx) <= off) return 'v';
  if (dx >= 1 && padH >= 1 && Math.abs(padH - dx) <= 1 && Math.abs(dy) <= off) return 'h';
  return null;
}
// the boxes the capture drew over a scrollbar's room: the room went to whatever ran the content
// width under the guttered box (a block, a stretched item) and down the flexible boxes inside it (a
// row's text column), each drawn that room wider than the browser drew it (its tag says so). Each
// takes the browser's width again, from the top down: it fills its column when it ran all of it,
// else it takes its tag's width. In a free frame that lost the room, what stood against its right
// edge moves with it (a meta pinned to the right); an auto layout frame places its own
function narrowToGutter(P, room, raw, was) {
  if (!('children' in P)) return 0;
  const lm = P.layoutMode, V = lm === 'VERTICAL', auto = V || lm === 'HORIZONTAL';
  const inner = P.width - (P.paddingLeft || 0) - (P.paddingRight || 0);
  const shrank = was.has(P) && Math.abs(was.get(P) - P.width - room) <= 1;
  let n = 0;
  for (const c of P.children) {
    if (c.visible === false) continue;
    const r = raw.get(c), wh = r ? whOf(r.tags) : null;
    const box = c.type !== 'TEXT' && 'children' in c && c.layoutPositioning !== 'ABSOLUTE';
    if (box && wh && Math.abs(c.width - wh[0] - room) <= 1) {
      try {
        if (V && Math.abs(wh[0] - inner) <= 1.5) c.layoutSizingHorizontal = 'FILL';
        else {
          const sv = auto && 'layoutMode' in c && c.layoutMode !== 'NONE' ? c.layoutSizingVertical : null;
          if (auto) c.layoutSizingHorizontal = 'FIXED';
          c.resize(wh[0], c.height);
          if (sv === 'HUG') c.layoutSizingVertical = 'HUG';
        }
        n++;
      } catch (e) { continue; }
      n += narrowToGutter(c, room, raw, was);
    } else if (box && (!wh || Math.abs(c.width - wh[0]) <= 1) && was.has(c) && was.get(c) - c.width > room - 1) {
      // it narrowed with its parent (it fills it): what it holds may not have
      n += narrowToGutter(c, room, raw, was);
    } else if (shrank && !auto && Math.abs(c.x + c.width - (P.width + room)) <= 1) {
      // in a free frame that lost the room, what stood against its right edge moves with it
      try { c.x -= room; } catch (e) {}
    }
  }
  return n;
}
// a margin wrapper that can go: it paints nothing, holds one layer and only adds room along its
// parent's axis (a side margin, or an auto margin that grows to push its layer, stays a wrapper)
function marginOf(w, V) {
  if (w.type !== 'FRAME' || paints(w) || w.children.length !== 1 || w.clipsContent) return null;
  if (w.layoutMode !== 'VERTICAL' && w.layoutMode !== 'HORIZONTAL') return null;
  const c = w.children[0];
  if (c.layoutPositioning === 'ABSOLUTE' || c.visible === false) return null;
  const lead = V ? w.paddingTop : w.paddingLeft, trail = V ? w.paddingBottom : w.paddingRight;
  const side = V ? w.paddingLeft + w.paddingRight : w.paddingTop + w.paddingBottom;
  const along = V ? w.height - c.height : w.width - c.width;
  const across = V ? w.width - c.width : w.height - c.height;
  if (side > 0.5 || Math.abs(along - lead - trail) > 0.5 || Math.abs(across) > 0.5) return null;
  return { lead, trail };
}
function hoist(F, wrappers, ownSizing) {
  const V = F.layoutMode === 'VERTICAL';
  if (!V && F.layoutMode !== 'HORIZONTAL') return 0;
  if (F.layoutWrap === 'WRAP' || F.primaryAxisAlignItems === 'SPACE_BETWEEN') return 0;
  const kids = F.children.filter((c) => c.layoutPositioning !== 'ABSOLUTE');
  if (kids.length < 2 || kids.some((c) => c.visible === false)) return 0;
  // only margin wrappers go: an 'align' frame is a plain layer here, and it stays
  const m = kids.map((c) => (wrappers.get(c) === 'margin' ? marginOf(c, V) : { lead: 0, trail: 0, plain: true }));
  if (m.some((x) => !x) || m.every((x) => x.plain)) return 0;
  const gaps = [];
  for (let i = 1; i < m.length; i++) gaps.push(F.itemSpacing + m[i - 1].trail + m[i].lead);
  if (Math.max(...gaps) - Math.min(...gaps) > 0.5) return 0;
  // the same room between every pair is the parent's gap; the first and last margins its padding
  F.itemSpacing = Math.round(gaps[0] * 10) / 10;
  if (V) { F.paddingTop += m[0].lead; F.paddingBottom += m[m.length - 1].trail; }
  else { F.paddingLeft += m[0].lead; F.paddingRight += m[m.length - 1].trail; }
  let n = 0;
  kids.forEach((w, i) => { if (!m[i].plain) { unwrap(F, w, ownSizing.get(w)); n++; } });
  return n;
}
// c leaves its margin wrapper w for F. The grow and the stretch c had in w were for w's axes, not
// F's (a title that filled its wrapper would take F's whole row), and so is any size it grows to on
// the way: c keeps the size it was drawn at and takes its own sizing back — the one a baked wrapper
// recorded, else w's where c filled w, hugging rather than fixed while it hugs to the drawn size
function unwrap(F, w, own) {
  const c = w.children[0];
  const drawn = [c.width, c.height];
  const want = own ? [own.h, own.v] : [[c.layoutSizingHorizontal, w.layoutSizingHorizontal], [c.layoutSizingVertical, w.layoutSizingVertical]]
    .map(([mine, outer]) => (mine !== 'FILL' ? mine : outer === 'FIXED' ? 'HUG' : outer));
  const grow = w.layoutGrow;
  F.insertChild(F.children.indexOf(w), c);
  w.remove();
  try { c.layoutGrow = 0; c.layoutAlign = 'INHERIT'; } catch (e) {}
  sizeAs(c, want, drawn);
  // a hug that does not come back to the drawn size stays fixed, one axis at a time and the width
  // first: a text that runs on one line when it hugs both ways wraps again at its drawn width, and
  // there its height hugs back to the drawn one (it can still grow with its content)
  for (const i of [0, 1]) {
    const got = i ? c.height : c.width;
    if (want[i] === 'HUG' && Math.abs(got - drawn[i]) > 1) { want[i] = 'FIXED'; sizeAs(c, want, drawn); }
  }
  try { if (grow === 1) c.layoutGrow = 1; } catch (e) {}
}
// c at the given size, then sized as asked: resize() fixes both axes (a text's too), so it goes
// first, and a fixed axis keeps that size while hug and fill take the others over
function sizeAs(c, want, size) {
  try { c.resize(size[0], size[1]); } catch (e) {}
  ['layoutSizingHorizontal', 'layoutSizingVertical'].forEach((k, i) => {
    const s = want[i] === 'HUG' && !canHug(c) ? 'FIXED' : want[i];
    try { c[k] = s; } catch (e) {}
  });
}

// ---- alignment ----------------------------------------------------------------------------------
// the layers from a child of a flex box down to the element it holds: a margin wrapper holds the
// element it was made for, and the element carries the tags
function throughMargins(c, wrappers) {
  const path = [c];
  while (wrappers.get(c) === 'margin' && c.children.length === 1) { c = c.children[0]; path.push(c); }
  return path;
}
// whether align-self on F's items works across F: across a flex box's direction, and on the
// vertical axis in a grid (the runtime tags a grid item only in a grid of one row, which lays out
// as a row). The box is the tagged element that F is, or whose scrolled content F holds; an
// untagged frame, or a frame that runs the other way (a grid of one column), has nowhere to align
function alignsAcross(F, V, raw, wrappers) {
  let B = F;
  while (wrappers.get(B) === 'content') B = B.parent;
  return raw.has(B) && /^c/.test(U(B, 'fx')) === V;
}
// c in a frame of its own, in c's place: the frame runs its parent's whole cross axis and aligns c
// there, and runs along the parent's axis as c does (it grows when c grows, else it fits c)
function alignIn(c, align) {
  const F = c.parent, V = F.layoutMode === 'VERTICAL', grow = c.layoutGrow;
  const W = figma.createFrame();
  W.name = 'align'; W.fills = []; W.clipsContent = false;
  W.layoutMode = F.layoutMode;
  try { W.counterAxisAlignItems = align; } catch (e) {}
  takePlace(W, c);
  try {
    W[V ? 'layoutSizingHorizontal' : 'layoutSizingVertical'] = 'FILL';
    W[V ? 'layoutSizingVertical' : 'layoutSizingHorizontal'] = grow === 1 ? 'FILL' : 'HUG';
  } catch (e) {}
}

const out = {};
for (const id of PARAMS.screens) {
  const frame = await figma.getNodeByIdAsync(id);
  if (!frame) { out[id] = 'missing'; continue; }
  const stats = { layers: 0, ui: 0, icons: 0, links: 0, wrappers: 0, hoisted: 0, cells: 0 };
  const raw = new Map();
  const extra = (PARAMS.addTags || {})[id] || {};
  for (const n of frame.findAll((x) => x.name.includes('[['))) {
    const m = n.name.match(TAG);
    if (!m) continue;
    const tags = parse(m[2]);
    const more = extra[(tags.ui ? 'ui:' + tags.ui.split('|')[0] : 'n:' + tags.n) + '|' + tags.wh];
    if (more) { for (const [k, v] of Object.entries(more)) if (!(k in tags)) tags[k] = v; stats.added = (stats.added || 0) + 1; }
    raw.set(n, { str: m[2], tags, label: m[3] });
  }
  // the scrollbar's room: the browser laid the content beside it, the capture over it. It comes
  // back as padding before anything compares a layer with its tag (a margin baked into a child is
  // only seen once the child is back at the browser's width). Once per element: the layers that
  // repeat its label repeat its tags too. The room each element got is kept: it is padding a
  // margin baked into the same frame must not take
  // the capture's own boxes, before anything moves them: the geometry audit tells a box the build
  // moved from one the capture drew off the browser's by its whole-pixel text lines (a line of
  // 18.125 px comes out 19, and the rounding adds up down a page). Per component, in tree order
  const fb0 = frame.absoluteBoundingBox, capGeo = {};
  const shown = (n) => { for (let x = n; x && x !== frame; x = x.parent) if (x.visible === false) return false; return true; };
  for (const [n, r] of raw) {
    if (PH.test(n.name) || !outermost(n, raw) || !r.tags.ui || !shown(n)) continue;
    const e = pickElement(chainOf(n, raw), r.tags), b = e.absoluteBoundingBox;
    if (!b) continue;
    const ui = r.tags.ui.split('|')[0];
    (capGeo[ui] = capGeo[ui] || []).push([b.x - fb0.x, b.y - fb0.y, b.width, b.height].map((v) => Math.round(v * 10) / 10));
  }
  if (!U(frame, 'capGeo')) SET(frame, 'capGeo', JSON.stringify(capGeo));
  stats.gutters = 0;
  const gutter = new Map();
  for (const [n, r] of raw) {
    if (PH.test(n.name) || !outermost(n, raw)) continue;
    const g = gutterOf(r.tags);
    if (!g.some((v) => v > 0)) continue;
    const e = pickElement(chainOf(n, raw), r.tags);
    if (!('layoutMode' in e) || e.layoutMode === 'NONE') continue;
    // the widths the capture drew, before the room comes back: what fills e narrows on its own
    const was = new Map();
    if (g[0] + g[2] > 0) for (const n of e.findAll(() => true)) was.set(n, n.width);
    e.paddingRight += g[0]; e.paddingBottom += g[1]; e.paddingLeft += g[2];
    gutter.set(e, g);
    stats.gutters += g.filter((v) => v > 0).length;
    if (g[0] + g[2] > 0) stats.narrowed = (stats.narrowed || 0) + narrowToGutter(e, g[0] + g[2], raw, was);
  }
  // a sticky element comes twice: a placeholder that holds its room in the flow and the element
  // itself, absolutely positioned over it. On a still screen the element takes the placeholder's
  // room (the innermost placeholder: an outer one is the element's margin)
  const phs = [...raw.keys()].filter((n) => PH.test(n.name) && !(('children' in n) && n.children.some((c) => raw.has(c) && PH.test(c.name) && raw.get(c).str === raw.get(n).str)));
  const pairs = stickyPairs(phs, raw);
  // the labels that have a placeholder: their layers belong to it, paired or not
  const claimed = new Set(phs.map((P) => raw.get(P).str));
  stats.sticky = 0; stats.unpaired = 0;
  for (const P of phs) {
    if (P.removed) continue;
    const real = pairs.get(P), parent = P.parent;
    if (!real || real.removed || !parent) { raw.delete(P); P.name = 'placeholder'; stats.unpaired++; continue; }
    const idx = parent.children.indexOf(P), cell = cellOf(P);
    const auto = 'layoutMode' in parent && parent.layoutMode !== 'NONE';
    const keep = { h: P.layoutSizingHorizontal, v: P.layoutSizingVertical, grow: P.layoutGrow, x: P.x, y: P.y, w: P.width, hh: P.height };
    // the placeholder leaves first: in a grid the element takes the cell it frees
    raw.delete(P); P.remove();
    parent.insertChild(idx, real);
    try { real.layoutPositioning = 'AUTO'; } catch (e) {}
    if (cell) { backToCell(real, cell); stats.cells++; }
    if (auto) {
      try { real.layoutGrow = keep.grow; } catch (e) {}
      for (const [k, v] of [['layoutSizingHorizontal', keep.h], ['layoutSizingVertical', keep.v]]) { try { real[k] = v === 'HUG' && !canHug(real) ? 'FIXED' : v; } catch (e) {} }
    } else { real.x = keep.x; real.y = keep.y; }
    if (real.layoutSizingHorizontal === 'FIXED' || real.layoutSizingVertical === 'FIXED') {
      try { real.resize(real.layoutSizingHorizontal === 'FIXED' ? keep.w : real.width, real.layoutSizingVertical === 'FIXED' ? keep.hh : real.height); } catch (e) {}
    }
    stats.sticky++;
  }
  // out of the flow and lifted out of its row by the capture: a sticky label stuck to the left of
  // a timeline, a bar or a mark drawn over a row's track. It goes back into the one component whose
  // box holds it, where it was; a bar or a mark on into the innermost tagged box there that holds
  // it (a sticky layer sits where it was pinned, not where its row put it, so it goes no deeper than
  // the row). A layer no single component holds (a day line or a now line across every row) stays.
  // So does a layer with a placeholder that found no room for it: it sits where it was pinned, over
  // content that is not its own (a header pinned over a body scrolled under it)
  stats.rehomed = 0;
  for (const [L, r] of [...raw]) {
    const pos = r.tags.pos;
    if (L.removed || (pos !== 'a' && pos !== 's') || L.layoutPositioning !== 'ABSOLUTE' || claimed.has(r.str)) continue;
    const P = L.parent, lb = L.absoluteBoundingBox;
    if (!P || !raw.has(P) || !lb) continue;
    let home = holderOf(P, L, lb, raw, true);
    if (!home) continue;
    if (pos === 'a') for (let d; (d = holderOf(home, L, lb, raw, false)); ) home = d;
    rehome(L, home, lb, pos);
    stats.rehomed++;
  }
  // layers that repeat a label: the element and the wrappers the capture made around or inside it
  const wrappers = new Map();
  for (const [n, r] of raw) {
    if (!outermost(n, raw)) continue;
    const chain = chainOf(n, raw);
    if (chain.length < 2) continue;
    const at = chain.indexOf(pickElement(chain, r.tags));
    chain.forEach((c, i) => { if (i !== at) wrappers.set(c, i < at ? 'margin' : 'content'); });
  }
  // margins the capture baked into the element's own frame as padding (a note 10 px lower and
  // taller than its box, a chip row with 14 px on top): the padding moves to a margin wrapper,
  // and the wrapper goes the way every margin goes (a gap of its parent, or a wrapper that stays).
  // The wrapper remembers the element's own sizing, which comes back if the wrapper goes
  stats.baked = 0;
  const ownSizing = new Map();
  const unbake = (n, r) => {
    if (n.removed || wrappers.has(n) || n.type !== 'FRAME' || !('layoutMode' in n) || n.layoutMode === 'NONE') return false;
    const wh = whOf(r.tags); if (!wh) return false;
    const P = n.parent; if (!P || !('children' in P) || P === frame) return false;
    const g = gutter.get(n) || [0, 0, 0];
    const ax = bakedAxis(n, r.label, wh, g); if (!ax) return false;
    const side = ax === 'h';
    // the padding on that axis, less the scrollbar's room in it: that room stays in n
    const [A, Z] = side ? ['paddingLeft', 'paddingRight'] : ['paddingTop', 'paddingBottom'];
    const room = side ? [g[2], g[0]] : [0, g[1]];
    const auto = 'layoutMode' in P && P.layoutMode !== 'NONE';
    const keep = { h: n.layoutSizingHorizontal, v: n.layoutSizingVertical, grow: n.layoutGrow, x: n.x, y: n.y, w: n.width, hh: n.height, abs: n.layoutPositioning };
    const W = figma.createFrame();
    W.name = 'margin'; W.fills = []; W.clipsContent = false;
    W.layoutMode = side ? 'HORIZONTAL' : 'VERTICAL';
    if (takePlace(W, n)) stats.cells++;
    W[A] = n[A] - room[0]; W[Z] = n[Z] - room[1]; n[A] = room[0]; n[Z] = room[1];
    try { W.primaryAxisSizingMode = 'FIXED'; W.counterAxisSizingMode = 'FIXED'; W.resize(keep.w, keep.hh); } catch (e) {}
    if (auto) {
      try { W.layoutGrow = keep.grow; } catch (e) {}
      for (const [k, v] of [['layoutSizingHorizontal', keep.h], ['layoutSizingVertical', keep.v]]) { try { W[k] = v === 'HUG' ? 'FIXED' : v; } catch (e) {} }
    }
    if (!auto || keep.abs === 'ABSOLUTE') { W.x = keep.x; W.y = keep.y; }
    try { n.layoutPositioning = 'AUTO'; n.layoutSizingHorizontal = 'FILL'; n.layoutSizingVertical = 'FILL'; } catch (e) {}
    ownSizing.set(W, { h: keep.h, v: keep.v });
    wrappers.set(W, 'margin'); stats.baked++;
    return true;
  };
  for (const [n, r] of [...raw]) unbake(n, r);
  const roots = [], scrolls = [];
  let sized = false;
  for (const [n, r] of raw) {
    if (wrappers.has(n)) { n.name = wrappers.get(n); stats.wrappers++; continue; }
    const tags = r.tags;
    // the capture's ':margin' suffix names its wrapper, not the element
    const label = r.label.replace(MARGIN, '');
    if (tags.wh) sized = true;
    stats.layers++;
    let name = tags.n || '';
    if (tags.section) { name = tags.section; SET(n, 'section', tags.section); }
    if (tags.slot) { name = name || 'slot/' + tags.slot; SET(n, 'slot', tags.slot); }
    if (tags.icon) { name = 'icon/' + tags.icon; SET(n, 'icon', tags.icon); stats.icons++; }
    if (tags.ui) {
      const [ui, props] = tags.ui.split('|');
      name = ui; SET(n, 'ui', ui); SET(n, 'props', props || '');
      roots.push(n); stats.ui++;
    }
    if (tags.to) { SET(n, 'link', tags.to); stats.links++; }
    if (tags.screen) SET(n, 'screenRoot', tags.screen);
    if (tags.gc) SET(n, 'gc', tags.gc);
    if (tags.gr) SET(n, 'gr', tags.gr);
    // a scroll box keeps its visible size: clipped, and scrollable in the prototype (its
    // scrollbar's room is already padding)
    if (tags.scroll && 'clipsContent' in n) {
      const axes = tags.scroll.split(':')[0];
      SET(n, 'scroll', axes);
      n.clipsContent = true;
      try { n.overflowDirection = axes === 'y' ? 'VERTICAL' : axes === 'x' ? 'HORIZONTAL' : 'BOTH'; } catch (e) {}
      stats.scroll = (stats.scroll || 0) + 1;
      scrolls.push(n);
    }
    if (tags.pos) SET(n, 'pos', tags.pos);
    if (tags.fx) SET(n, 'fx', tags.fx);
    if (tags.as) SET(n, 'as', tags.as);
    if (tags.ov) SET(n, 'ov', tags.ov);
    if (label) SET(n, 'label', label.slice(0, 200));
    n.name = name || (label ? label.slice(0, 48) : n.type.toLowerCase());
  }
  // older captures (no size in the tag) — the capture repeats the label of a scroll box on the
  // wrapper that holds its scrolled content (the only child, same axis): only the box scrolls
  for (const n of scrolls) {
    const p = n.parent;
    const axis = U(n, 'scroll');
    if (p && p !== frame && p.children.length === 1 && U(p, 'scroll') === axis) {
      SET(n, 'scroll', '');
      n.clipsContent = false;
      try { n.overflowDirection = 'NONE'; } catch (e) {}
      stats.scroll--; stats.scrollWrappers = (stats.scrollWrappers || 0) + 1;
    }
  }
  // older captures — a label repeated on a wrapper further in: the outermost layer stays the occurrence
  if (!sized) {
    for (const r of roots.slice()) {
      const ui = U(r, 'ui');
      let p = r.parent;
      while (p && p !== frame && !U(p, 'ui')) p = p.parent;
      if (p && p !== frame && U(p, 'ui') === ui) {
        for (const k of ['ui', 'props', 'link']) SET(r, k, '');
        r.name = ui + '/inner'; roots.splice(roots.indexOf(r), 1); stats.ui--;
      }
    }
  }
  // a wrapping row the browser broke into one item per line (a header whose count fell under its
  // title): Figma's space-between has no least gap, so it would pull them back onto one line; each
  // line starts at the left, as the browser's lone items did. Read from sizes, not positions (the
  // capture misplaces the items of a row that wraps): the box is exactly as tall as its items
  // stacked with the row gap between them (its tag's box and theirs, the browser's)
  const tall = (c) => { const r = raw.get(c), wh = r ? whOf(r.tags) : null; return wh ? wh[1] : c.height; };
  const loneLines = (F, items, wrap, rg, pad) => {
    if (!wrap || items.length < 2) return false;
    const stacked = items.reduce((t, c) => t + tall(c), 0) + rg * (items.length - 1);
    return Math.abs(tall(F) - pad - stacked) <= 3;
  };
  // flex boxes the capture left as free layout (a row that wraps, a header that spreads its two
  // texts): auto layout again, from the stylesheet's own rules; a row that already has it learns
  // to wrap and to spread
  stats.flexed = 0;
  const J = { s: 'MIN', e: 'MAX', c: 'CENTER', sb: 'SPACE_BETWEEN', sa: 'SPACE_BETWEEN', se: 'SPACE_BETWEEN' }, A = { s: 'MIN', e: 'MAX', c: 'CENTER', st: 'MIN', b: 'BASELINE' };
  for (const F of frame.findAll((x) => x.type === 'FRAME' && U(x, 'fx'))) {
    if (F.removed) continue;
    const m = U(F, 'fx').match(/^([rc])(w?):([\d.]+),([\d.]+):(\w+):(\w+)(?::(\d+(?:[ag]\d+)+))?$/);
    if (!m) continue;
    const row = m[1] === 'r', wrap = !!m[2] && row, cg = +m[3], rg = +m[4], jc = m[5], ai = m[6];
    const outOfFlow = (c) => U(c, 'pos') === 'a' || U(c, 'pos') === 'f';
    if (F.layoutMode === 'NONE') {
      const kids = F.children.filter((c) => c.visible !== false);
      const flow = kids.filter((c) => !outOfFlow(c));
      if (kids.length < 2 || !flow.length) continue;
      const size = [F.width, F.height];
      const lone = loneLines(F, flow, wrap, rg, 0);
      // lines that wrap and center each start where their own width leaves them: the first
      // item's offset is centering, not padding (a suggestion bar's second line started 16.7 in)
      const padL = row && wrap && jc === 'c' ? 0 : Math.max(0, Math.min(...flow.map((c) => c.x))), padT = Math.max(0, Math.min(...flow.map((c) => c.y)));
      const sizes = new Map(flow.map((c) => [c, [c.width, c.height]]));
      // the room after the items across the box is its padding too (a row's 8 px under its line):
      // without it the box that hugs later ends that much shorter than the browser drew it. Read
      // where the capture put the items, before auto layout moves them (read after, a header's
      // second line and a row's wrapped chips all sat on the first line: 19 and 150 px of padding).
      // An item reaches as far as the browser drew it (its tag's box: a text the capture set on
      // fewer lines ends short) or as its layer does (margins); items that overlap or stand on one
      // line they can't fit on are not where the browser drew them, and give no padding
      const overlap = flow.some((a, i) => flow.some((b, j) => j > i && a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1));
      const crammed = row && flow.every((c) => Math.abs(c.y - flow[0].y) <= 1) && flow.reduce((t, c) => t + c.width, 0) + cg * (flow.length - 1) > size[0] + 1;
      const far = (c) => { const r = raw.get(c), wh = r ? whOf(r.tags) : null; return row ? c.y + Math.max(c.height, wh ? wh[1] : 0) : c.x + Math.max(c.width, wh ? wh[0] : 0); };
      const trust = !overlap && !crammed;
      const padB = row && trust ? Math.max(0, size[1] - Math.max(...flow.map(far))) : 0;
      const padR = !row && trust ? Math.max(0, size[0] - Math.max(...flow.map(far))) : 0;
      // the room between two items beyond the box's gap is a margin (a team tile's member row
      // 7 px under its title, with no gap in the stylesheet): stacked at the gap, every item after
      // it moved up that much. It comes back as a margin wrapper, which the gaps pass below turns
      // into the box's gap where every pair agrees. Read where the capture put the items, in a box
      // that starts its items (spread or centered items measure free room, not margins)
      const extra = new Map();
      if (trust && !wrap && jc === 's') {
        const ord = flow.slice().sort((a, b) => (row ? a.x - b.x : a.y - b.y));
        for (let i = 1; i < ord.length; i++) {
          const a = ord[i - 1], b = ord[i];
          const g = (row ? b.x - (a.x + a.width) : b.y - (a.y + a.height)) - (row ? cg : rg);
          if (g > 0.5) extra.set(b, Math.round(g * 10) / 10);
        }
      }
      // an out-of-flow layer stays where the capture drew it: made absolute after auto layout had
      // stacked it with the items, it kept the flow's place (a tile's canvas sat inside its padding)
      const freeAt = new Map(kids.filter(outOfFlow).map((c) => [c, [c.x, c.y]]));
      F.layoutMode = row ? 'HORIZONTAL' : 'VERTICAL';
      try { F.layoutWrap = wrap ? 'WRAP' : 'NO_WRAP'; } catch (e) {}
      F.itemSpacing = row ? cg : rg;
      try { if (wrap) F.counterAxisSpacing = rg; } catch (e) {}
      F.paddingLeft = padL; F.paddingTop = padT; F.paddingRight = padR; F.paddingBottom = padB;
      try { F.primaryAxisAlignItems = lone ? 'MIN' : J[jc] || 'MIN'; F.counterAxisAlignItems = A[ai] || 'MIN'; } catch (e) {}
      try { F.primaryAxisSizingMode = 'FIXED'; F.counterAxisSizingMode = 'FIXED'; F.resize(size[0], size[1]); } catch (e) {}
      for (const c of flow) {
        const [w, h] = sizes.get(c);
        if (c.type !== 'TEXT') { try { c.layoutSizingHorizontal = 'FIXED'; c.layoutSizingVertical = 'FIXED'; c.resize(w, h); } catch (e) {} }
        // stretch: a child that ran the whole cross axis keeps running it
        if (ai === 'st' && c.type !== 'TEXT') { try { const inner = row ? size[1] - padT : size[0] - padL; if (Math.abs((row ? h : w) - inner) <= 1.5) { if (row) c.layoutSizingVertical = 'FILL'; else c.layoutSizingHorizontal = 'FILL'; } } catch (e) {} }
      }
      for (const c of kids) if (outOfFlow(c)) { try { c.layoutPositioning = 'ABSOLUTE'; const [x, y] = freeAt.get(c); c.x = x; c.y = y; } catch (e) {} }
      for (const [c, g] of extra) {
        const W = figma.createFrame();
        W.name = 'margin'; W.fills = []; W.clipsContent = false;
        W.layoutMode = row ? 'HORIZONTAL' : 'VERTICAL';
        try {
          F.insertChild(F.children.indexOf(c), W);
          const own = { h: c.layoutSizingHorizontal, v: c.layoutSizingVertical };
          W.appendChild(c);
          if (row) W.paddingLeft = g; else W.paddingTop = g;
          W.primaryAxisSizingMode = 'AUTO'; W.counterAxisSizingMode = 'AUTO';
          wrappers.set(W, 'margin'); ownSizing.set(W, own);
          stats.margins = (stats.margins || 0) + 1;
        } catch (e) {}
      }
      stats.flexed++;
      // a box the capture left without auto layout (a row that wraps) was not checked for a
      // margin baked into its padding above: now it has auto layout and its padding, it is (a
      // suggestion bar 12 px taller than the browser drew it, its margin on top)
      if (raw.has(F)) unbake(F, raw.get(F));
    } else if (F.layoutMode === 'HORIZONTAL' || F.layoutMode === 'VERTICAL') {
      let changed = false;
      if (wrap && F.layoutMode === 'HORIZONTAL' && F.layoutWrap !== 'WRAP') { try { F.layoutWrap = 'WRAP'; F.counterAxisSpacing = rg; changed = true; } catch (e) {} }
      const inFlow = F.children.filter((c) => c.visible !== false && c.layoutPositioning !== 'ABSOLUTE');
      const lone = F.layoutMode === 'HORIZONTAL' && loneLines(F, inFlow, wrap, rg, F.paddingTop + F.paddingBottom);
      if (lone && F.primaryAxisAlignItems === 'SPACE_BETWEEN') { try { F.primaryAxisAlignItems = 'MIN'; changed = true; } catch (e) {} }
      else if (!lone && J[jc] === 'SPACE_BETWEEN' && F.primaryAxisAlignItems !== 'SPACE_BETWEEN' && inFlow.length > 1) { try { F.primaryAxisAlignItems = 'SPACE_BETWEEN'; changed = true; } catch (e) {} }
      if (changed) stats.flexed++;
    }
    // the items that take the free room along the main axis (flexItems in the runtime): one that
    // grows fills it (a title that keeps its meta at the row's end), and one an auto margin pushes
    // away gets an empty spacer before it that takes the room (a column's count at the header's
    // right edge). Two items spread instead, without a spacer: the same picture. Nothing is pushed
    // where an item grows (the browser gives the grower all the room), nor on an axis that hugs.
    // Only when the capture kept one layer per item
    if (m[7] && (F.layoutMode === 'HORIZONTAL' || F.layoutMode === 'VERTICAL') && F.layoutWrap !== 'WRAP' && F.primaryAxisSizingMode === 'FIXED') {
      const flow = F.children.filter((c) => c.visible !== false && c.layoutPositioning !== 'ABSOLUTE');
      const em = m[7].match(/^(\d+)(.*)$/);
      if (+em[1] === flow.length) {
        const H = F.layoutMode === 'HORIZONTAL';
        const along = H ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
        const pushed = [];
        let textGrew = false;
        for (const [, k, i] of em[2].matchAll(/([ag])(\d+)/g)) {
          const c = flow[+i];
          if (!c) continue;
          if (k === 'a') { pushed.push(c); continue; }
          if (c.type === 'TEXT') textGrew = true;
          try {
            if (c.type === 'TEXT') { if (c.fontName !== figma.mixed) await figma.loadFontAsync(c.fontName); if (H) c.textAutoResize = 'HEIGHT'; }
            c[along] = 'FILL';
            stats.grown = (stats.grown || 0) + 1;
          } catch (e) {}
        }
        const grows = flow.some((c) => c[along] === 'FILL' || c.layoutGrow === 1);
        // an item that grows takes the free room: nothing is left to spread, and Figma's
        // space-between then drops the gap (a card's title ran into its date)
        if (grows && F.primaryAxisAlignItems === 'SPACE_BETWEEN') { try { F.primaryAxisAlignItems = 'MIN'; } catch (e) {} }
        // and a text that grows takes the room the capture left after it: a text-only item lost
        // its box, the capture kept the text's own width and measured the rest of the box as the
        // gap (a row's title, 143 px from its meta, wrapped onto two lines). The stylesheet's gap
        // comes back. A layer that kept its box was measured with it: its gap holds real margins
        if (textGrew && Math.abs(F.itemSpacing - (H ? cg : rg)) > 0.5) {
          try { F.itemSpacing = H ? cg : rg; stats.regapped = (stats.regapped || 0) + 1; } catch (e) {}
        }
        if (pushed.length && !grows) {
          if (flow.length === 2 && pushed.length === 1 && pushed[0] === flow[1]) { try { F.primaryAxisAlignItems = 'SPACE_BETWEEN'; stats.pushed = (stats.pushed || 0) + 1; } catch (e) {} }
          else if (F.primaryAxisAlignItems === 'MIN') {
            for (const c of pushed) {
              const sp = figma.createFrame();
              sp.name = 'spacer'; sp.fills = []; sp.clipsContent = false;
              try {
                F.insertChild(F.children.indexOf(c), sp);
                sp.resize(1, 1);
                sp[along] = 'FILL';
                stats.pushed = (stats.pushed || 0) + 1;
              } catch (e) { sp.remove(); }
            }
          }
        }
      }
    }
  }
  // an item that aligns itself across its flex box (align-self: a day divider centered in a column
  // that starts its items at the left). Figma aligns every item of an auto layout the same way: when
  // every item agrees that is the box's alignment, otherwise each such item sits in an 'align' frame
  // that runs the box's cross axis and aligns it there (none for an item the box already aligns
  // that way). A stretched item fills the cross axis when it was drawn across all of it (a text
  // keeps its own box: its glyphs sit where they sat). A margin wrapper is no flex box: the item it
  // holds aligns in the wrapper's parent
  stats.aligned = 0; stats.alignFrames = 0; stats.stretched = 0;
  const AS = { c: 'CENTER', e: 'MAX', s: 'MIN' };
  for (const F of frame.findAll((x) => x.type === 'FRAME' && (x.layoutMode === 'VERTICAL' || x.layoutMode === 'HORIZONTAL') && wrappers.get(x) !== 'margin')) {
    const V = F.layoutMode === 'VERTICAL';
    if (!alignsAcross(F, V, raw, wrappers)) continue;
    const kids = F.children.filter((c) => c.visible !== false && c.layoutPositioning !== 'ABSOLUTE');
    const paths = kids.map((c) => throughMargins(c, wrappers));
    const as = paths.map((p) => U(p[p.length - 1], 'as'));
    if (!as.some(Boolean)) continue;
    const across = V ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
    const inner = V ? F.width - F.paddingLeft - F.paddingRight : F.height - F.paddingTop - F.paddingBottom;
    const all = as.every((a) => a === as[0]) ? AS[as[0]] : null;
    if (all) { try { F.counterAxisAlignItems = all; stats.aligned++; } catch (e) {} }
    paths.forEach((p, i) => {
      if (as[i] === 'st') {
        // stretch leaves an item that something holds short of the cross axis (a max-width) at
        // the size it was drawn; its margins, the outer layers of p, are part of what stretches
        if (Math.abs((V ? p[0].width : p[0].height) - inner) > 1.5) return;
        for (const x of p) if (x.type !== 'TEXT') { try { x[across] = 'FILL'; } catch (e) {} }
        stats.stretched++;
      } else if (AS[as[i]] && !all && AS[as[i]] !== F.counterAxisAlignItems) { alignIn(kids[i], AS[as[i]]); stats.alignFrames++; }
    });
  }
  // margins as gaps: every auto layout frame whose children are margin wrappers with one room
  const flows = frame.findAll((x) => x.type === 'FRAME' && (x.layoutMode === 'VERTICAL' || x.layoutMode === 'HORIZONTAL'));
  for (const F of flows) {
    if (F.removed || !F.children.some((c) => wrappers.get(c) === 'margin')) continue;
    stats.hoisted += hoist(F, wrappers, ownSizing);
  }
  // a child that fills an axis its parent hugs has no length of its own: the capture draws it at
  // the browser's size, and the first relayout (a clone, a component, an instance) collapses it
  // to nothing. It keeps the size it was drawn at
  stats.settled = 0;
  for (const F of flows) {
    if (F.removed) continue;
    const H = F.layoutMode === 'HORIZONTAL';
    const hugsW = H ? F.primaryAxisSizingMode === 'AUTO' : F.counterAxisSizingMode === 'AUTO';
    const hugsH = H ? F.counterAxisSizingMode === 'AUTO' : F.primaryAxisSizingMode === 'AUTO';
    if (!hugsW && !hugsH) continue;
    for (const c of F.children) {
      if (c.layoutPositioning === 'ABSOLUTE') continue;
      const w = c.width, h = c.height;
      const text = c.type === 'TEXT';
      try {
        if (hugsW && (c.layoutSizingHorizontal === 'FILL' || (H && c.layoutGrow === 1))) {
          c.layoutGrow = 0; c.layoutSizingHorizontal = 'FIXED'; c.resize(w, c.height);
          if (text) c.textAutoResize = 'HEIGHT';
          stats.settled++;
        }
        if (hugsH && (c.layoutSizingVertical === 'FILL' || (!H && c.layoutGrow === 1))) {
          c.layoutGrow = 0;
          if (text) c.layoutSizingVertical = 'HUG'; else { c.layoutSizingVertical = 'FIXED'; c.resize(c.width, h); }
          stats.settled++;
        }
      } catch (e) {}
    }
  }
  // slot texts of each component root, for component text properties
  for (const r of roots) {
    const slots = {};
    for (const s of r.findAll((x) => U(x, 'slot') !== '')) {
      let p = s.parent, own = true;
      while (p && p !== r) { if (U(p, 'ui')) { own = false; break; } p = p.parent; }
      if (!own) continue;
      const t = s.type === 'TEXT' ? s : s.findOne((x) => x.type === 'TEXT');
      if (t) slots[U(s, 'slot')] = t.characters.replace(/\s+/g, ' ').trim();
    }
    if (Object.keys(slots).length) SET(r, 'slots', JSON.stringify(slots));
  }
  // a ring drawn with an inset shadow (box-shadow: inset 0 0 0 1px — a round send button's
  // outline): Figma draws an inner shadow only where the box is painted, and on a transparent box
  // the ring disappeared. With no blur and no offset it is an inside stroke of its spread
  stats.rings = 0;
  for (const n of frame.findAll((x) => 'effects' in x && 'strokes' in x && x.effects.length)) {
    const ring = n.effects.find((e) => e.type === 'INNER_SHADOW' && e.visible !== false && !e.radius && !e.offset.x && !e.offset.y && e.spread > 0);
    if (!ring || n.strokes.some((p) => p.visible !== false)) continue;
    try {
      n.strokes = [{ type: 'SOLID', color: { r: ring.color.r, g: ring.color.g, b: ring.color.b }, opacity: ring.color.a }];
      n.strokeWeight = ring.spread; n.strokeAlign = 'INSIDE';
      n.effects = n.effects.filter((e) => e !== ring);
      stats.rings++;
    } catch (e) {}
  }
  // anonymous text wrappers keep Figma's default name; give them their text
  for (const t of frame.findAllWithCriteria({ types: ['TEXT'] })) {
    if (/^(Italic |Bold )?Text$/.test(t.name)) t.name = t.characters.replace(/\s+/g, ' ').trim().slice(0, 48) || 'Text';
  }
  out[id] = stats;
}
return out;
