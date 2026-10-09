// use_figma script template — builds the components of one nesting level from EVERY screen at
// once (read-only on the screens: they are swapped later, in batches, by swap-level.js).
//
// Seeing every occurrence first is what keeps the variants few and right:
//   · a variant is a declared props value (adapter) × a structure; width and position never
//     make a variant. Occurrences that are the same parts minus some (a row without its count)
//     join the most complete one, and those parts get a boolean property.
//   · a list keeps its rows in a SLOT ("Rows", the main shows `keep` of them) and a container
//     keeps in a SLOT ("Content") whatever changes between screens; what is the same in all
//     of them (a header, a footer) stays in the component, editable once for every screen.
//   · a grid column whose width changes between occurrences becomes a flexible track.
// Run inner levels first (an Avatar before the InboxRow that holds it).
const PARAMS = /*PARAMS*/ { ui: [], kinds: {}, lists: {}, screens: [], componentsPage: '', codeRefs: {}, keep: 5, origin: [0, 0], budgetMs: 40000, minW: {}, slotText: {},
  text: { ref: 'From the prototype: {ref}', none: 'From the prototype.' } } /*END*/;
// minW: { ui: { slot: { px, path } } } — the CSS width floors of slot texts (lib/dom-map.mjs minWidthsOf)
// slotText: { ui: { slot: { values, path } } } — the texts each slot showed (lib/dom-map.mjs slotTextsOf)
/*TEXT*/
/*KIT:build*/
const T0 = Date.now();
const compPage = await figma.getNodeByIdAsync(PARAMS.componentsPage);
const frames = [];
for (const id of PARAMS.screens) { const f = await figma.getNodeByIdAsync(id); if (f) frames.push(f); }
const uis = new Set(PARAMS.ui);

const owners = {};
for (const n of compPage.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })) {
  const c = U(n, 'component');
  if (c && uis.has(c) && !U(n, 'old')) owners[c] = n;
}
const occ = {};
for (const f of frames) { await breathe(); for (const n of occurrences(f, uis)) (occ[U(n, 'ui')] = occ[U(n, 'ui')] || []).push(n); }

let cursorY = PARAMS.origin[1];
for (const c of compPage.children) cursorY = Math.max(cursorY, c.y + c.height + 160);

// rep → its clone, part by part (the clone is the main; members map into rep)
const twinOf = (a, b, m = new Map()) => { m.set(a, b); if ('children' in a && a.type !== 'INSTANCE') a.children.forEach((c, i) => twinOf(c, b.children[i], m)); return m; };
// grids whose stylesheets declared other columns (a 168 px label column here, 330 px there) never
// share a main: a track's size is not something an instance can override
const fitsRoot = (o, r) => sameCols(o, r) && (!('children' in o) || !o.children.length ? !('children' in r) || !r.children.length : !!('children' in r && pick(o.children, r.children)));
const mapRoot = (o, r) => { const m = new Map([[o, r]]); if ('children' in o && o.children.length) { const p = pick(o.children, r.children); o.children.forEach((c, i) => mapInto(c, r.children[p[i]], m)); } return m; };
// chrome of a slotted member → rep, by index along the path (the parts outside the slot are the same)
function mapChrome(o, r, spec) {
  const m = new Map([[o, r]]);
  if (spec.cells) { o.children.forEach((c, i) => { m.set(c, r.children[i]); }); return m; }
  const byIndex = (a, b) => { m.set(a, b); if ('children' in a && a.type !== 'INSTANCE' && a.children.length === b.children.length) a.children.forEach((c, i) => byIndex(c, b.children[i])); };
  let a = o, b = r;
  for (let d = 0; d <= spec.path.length; d++) {
    const last = d === spec.path.length;
    const pre = last ? spec.pre : spec.path[d];
    const post = last ? spec.post : b.children.length - pre - 1;
    for (let i = 0; i < pre; i++) byIndex(a.children[i], b.children[i]);
    for (let i = 1; i <= post; i++) byIndex(a.children[a.children.length - i], b.children[b.children.length - i]);
    if (last) break;
    a = a.children[pre]; b = b.children[pre]; m.set(a, b);
  }
  return m;
}
// rep part → the members' parts that map onto it
function byPart(maps) {
  const parts = new Map();
  for (const mp of maps) for (const [a, b] of mp) { if (!parts.has(b)) parts.set(b, []); parts.get(b).push(a); }
  return parts;
}
// the item of a row that grows (flex: 1 1 26ch): on every occurrence it takes what its line leaves
// over, and its width changes from one occurrence to the next. The main lets it fill: an instance
// can't give a layer of its own another width (a 1 039 px title column in a 330 px card row pushed
// the date to a line of its own). A text keeps its own box
function lineUse(F, c) {
  const inner = F.width - F.paddingLeft - F.paddingRight;
  const line = F.children.filter((s) => s.visible !== false && s.layoutPositioning !== 'ABSOLUTE' && s.y < c.y + c.height && s.y + s.height > c.y);
  const used = line.reduce((t, s) => t + s.width, 0) + F.itemSpacing * (line.length - 1);
  return [+used.toFixed(1), +inner.toFixed(1), line.length];
}
// an empty item still takes its gap in the browser (a meta with nothing to say leaves the title
// 14 px short of the row's end) and has no layer in the capture: the line counts one gap more
// Figma sets a text's glyphs narrower or wider than the browser did: each text on the line adds
// 6 % of its width to what counts as full (a 91 px date read 5 px short)
const lineFull = (F, c) => {
  const [used, inner] = lineUse(F, c);
  const texts = F.children.filter((s) => s !== c && s.type === 'TEXT' && s.visible !== false && s.y < c.y + c.height && s.y + s.height > c.y);
  const tol = 4 + 0.06 * texts.reduce((t, s) => t + s.width, 0);
  return Math.abs(used - inner) <= tol || Math.abs(used + F.itemSpacing - inner) <= tol;
};
// an item whose width changes between occurrences but that doesn't fill its line on every one of
// them (reported: the main keeps its fixed width, so some instances draw it at another's width)
const growMisses = [];
function growItems(parts, partOf) {
  let n = 0;
  for (const [b, rows] of parts) {
    const main = partOf(b);
    if (!main || main.type === 'INSTANCE' || b.layoutMode !== 'HORIZONTAL' || main.layoutMode !== 'HORIZONTAL' || hugsAxis(main, true) || rows.length < 2) continue;
    for (const cb of b.children) {
      if (cb.type === 'TEXT' || cb.visible === false || cb.layoutPositioning === 'ABSOLUTE') continue;
      const occ = (parts.get(cb) || []).filter((a) => a.parent && a.parent.layoutMode === 'HORIZONTAL');
      if (occ.length < 2) continue;
      const ws = occ.map((a) => a.width);
      if (Math.max(...ws) - Math.min(...ws) <= 4) continue;
      const short = occ.filter((a) => !lineFull(a.parent, a));
      if (cb.layoutSizingHorizontal !== 'FIXED' || short.length) {
        if (growMisses.length < 12) growMisses.push([U(b, 'ui') || b.name, cb.name, cb.layoutSizingHorizontal, occ.length, short.length, short.slice(0, 2).map((a) => lineUse(a.parent, a))]);
        continue;
      }
      const t = partOf(cb);
      if (t) { try { t.layoutSizingHorizontal = 'FILL'; n++; } catch (e) {} }
    }
  }
  return n;
}
// a box as wide as its own content on every occurrence, at widths that differ between them (a
// pill that reads "Reading" here and "Writing a reply" there, a group's title beside its count):
// the main hugs it. Kept at the rep's width it clipped every longer text. The root too, unless a
// slot decides its sizing (hugPlan)
function hugContent(parts, partOf, comp, slotted) {
  let n = 0;
  for (const [b, list] of parts) {
    const d = partOf(b);
    if (!d || d.type === 'INSTANCE' || list.length < 2 || (d.layoutMode !== 'HORIZONTAL' && d.layoutMode !== 'VERTICAL')) continue;
    if (d === comp ? slotted : d.layoutSizingHorizontal !== 'FIXED') continue;
    if (d.layoutWrap === 'WRAP' || /x/.test(U(d, 'scroll')) || hugsAxis(d, true)) continue;
    const ws = list.map((a) => a.width);
    if (Math.max(...ws) - Math.min(...ws) <= 2 || !list.every((a) => driven(a, true))) continue;
    try {
      if (d === comp) { if (d.layoutMode === 'HORIZONTAL') d.primaryAxisSizingMode = 'AUTO'; else d.counterAxisSizingMode = 'AUTO'; }
      else d.layoutSizingHorizontal = 'HUG';
      n++;
    } catch (e) {}
  }
  return n;
}
// a one-line text that ends in "…" (ov:e, text-overflow: ellipsis). Where the box takes its
// width from its row or column (it grows, flex: 1) or the browser cut this occurrence's text, the
// text fills the box and is cut there in every instance (a card title ran under the date). A box
// as wide as its text (a pill, a name under an avatar) hugs it instead, and so do the boxes around
// it that were as wide as their content: fixed at the browser's width, Figma's glyphs, a few
// percent wider, cut "Writing" to "Writi…". Past the box's max width the text is cut there
async function ellipsize(comp, slotted) {
  let n = 0;
  for (const f of comp.findAll((x) => x.type === 'FRAME' && U(x, 'ov') === 'e')) {
    const t = f.children.length === 1 && f.children[0].type === 'TEXT' ? f.children[0] : null;
    if (!t || (f.layoutMode !== 'HORIZONTAL' && f.layoutMode !== 'VERTICAL')) continue;
    const P = f.parent;
    const flowP = !!P && (P.layoutMode === 'HORIZONTAL' || P.layoutMode === 'VERTICAL');
    const inner = f.width - f.paddingLeft - f.paddingRight;
    const cut = t.width > inner * 1.08 + 2;
    const given = flowP && !hugsAxis(P, true) && (f.layoutSizingHorizontal === 'FILL' || f.layoutGrow === 1);
    const up = [];
    if (!given && !cut) {
      for (let A = P; A && (A.layoutMode === 'HORIZONTAL' || A.layoutMode === 'VERTICAL'); A = A.parent) {
        if (A.layoutWrap === 'WRAP' || /x/.test(U(A, 'scroll')) || U(A, 'slotFrame') || (A === comp && slotted) || !driven(A, true)) break;
        up.push(A);
        if (A === comp) break;
      }
    }
    try {
      await loadFontsOf(t);
      if (given || cut) {
        t.textAutoResize = 'HEIGHT'; t.layoutSizingHorizontal = 'FILL';
      } else {
        if (flowP) f.layoutSizingHorizontal = 'HUG';
        else if (f.layoutMode === 'HORIZONTAL') f.primaryAxisSizingMode = 'AUTO'; else f.counterAxisSizingMode = 'AUTO';
        t.textAutoResize = 'WIDTH_AND_HEIGHT';
        if (f.maxWidth) t.maxWidth = Math.max(1, f.maxWidth - f.paddingLeft - f.paddingRight);
        for (const A of up) {
          if (A !== comp) A.layoutSizingHorizontal = 'HUG';
          else if (A.layoutMode === 'HORIZONTAL') A.primaryAxisSizingMode = 'AUTO'; else A.counterAxisSizingMode = 'AUTO';
        }
      }
      if (given || cut || f.maxWidth) { t.textTruncation = 'ENDING'; t.maxLines = 1; }
      n++;
    } catch (e) {}
  }
  return n;
}
// a grid of one cell (display: grid; place-items: center — an avatar's initials, a glyph in its
// button) is auto layout aligned the same way. A grid inside an instance can't take the tracks of
// another main: swapped from a glyph avatar to an initials one, the nested avatar kept no row and
// its initials sat 7 px above it
function oneCell(comp) {
  const AL = { CENTER: 'CENTER', MAX: 'MAX' };
  let n = 0;
  const walk = (f) => {
    if (f.type === 'INSTANCE' || !('children' in f)) return;
    for (const c of f.children) walk(c);
    if (f.layoutMode !== 'GRID') return;
    const flow = f.children.filter((c) => c.layoutPositioning !== 'ABSOLUTE');
    let cells = 0; try { cells = f.gridRowCount * f.gridColumnCount; } catch (e) { return; }
    if (cells !== 1 || flow.length !== 1) return;
    const k = flow[0];
    const hugW = hugsGrid(f, true), hugH = hugsGrid(f, false), w = f.width, h = f.height;
    const kw = k.layoutSizingHorizontal, kh = k.layoutSizingVertical;
    const ah = AL[k.gridChildHorizontalAlign] || 'MIN', av = AL[k.gridChildVerticalAlign] || 'MIN';
    try {
      f.layoutMode = 'HORIZONTAL';
      f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED'; f.resize(w, h);
      f.primaryAxisAlignItems = ah; f.counterAxisAlignItems = av;
      if (kw === 'FILL') k.layoutSizingHorizontal = 'FILL';
      if (kh === 'FILL') k.layoutSizingVertical = 'FILL';
      if (hugW) f.primaryAxisSizingMode = 'AUTO';
      if (hugH) f.counterAxisSizingMode = 'AUTO';
      n++;
    } catch (e) {}
  };
  walk(comp);
  return n;
}
// a layer laid over its whole box (position: absolute; inset: 0 — a backdrop, a canvas of dots)
// covers it at any size: it stretches with the box instead of keeping the rep's size. Its edges
// sit on the box's edges or on its padding (a canvas inside a team tile's padding kept the widest
// tile's 566 px in a 310 px tile). Its picture covers the box too: the capture fit one
// occurrence's bitmap, and fitted into a box of another shape it left bands (a canvas redraws
// itself at every size, so cover is what the browser shows)
function stretchOver(comp) {
  let n = 0;
  const near = (a, b) => Math.abs(a - b) <= 1;
  const walk = (P) => {
    for (const c of P.children || []) {
      if (c.type === 'INSTANCE') continue;
      const free = c.layoutPositioning === 'ABSOLUTE' || !P.layoutMode || P.layoutMode === 'NONE';
      const pl = P.paddingLeft || 0, pr = P.paddingRight || 0, pt = P.paddingTop || 0, pb = P.paddingBottom || 0;
      const covers = (near(c.x, 0) || near(c.x, pl)) && (near(c.y, 0) || near(c.y, pt))
        && (near(c.x + c.width, P.width) || near(c.x + c.width, P.width - pr)) && (near(c.y + c.height, P.height) || near(c.y + c.height, P.height - pb));
      if (free && 'constraints' in c && covers && c.width > 8 && c.height > 8) {
        try { c.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' }; n++; } catch (e) {}
        if (Array.isArray(c.fills) && c.fills.some((x) => x.type === 'IMAGE' && x.scaleMode === 'FIT')) {
          try { c.fills = c.fills.map((x) => (x.type === 'IMAGE' && x.scaleMode === 'FIT' ? { ...x, scaleMode: 'FILL' } : x)); } catch (e) {}
        }
      }
      walk(c);
    }
  };
  walk(comp);
  return n;
}
// flexible grid tracks, from how the members' columns differ
function flexFrom(parts, twin) {
  let changed = 0;
  for (const [b, list] of parts) {
    const c = twin.get(b);
    if (!c || c.layoutMode !== 'GRID') continue;
    // the stylesheet's own tracks when the capture carried them: 1fr grows, auto fits its content;
    // an axis nobody declared is read from the members (a column that changes width grows)
    const declared = applyDeclared(c);
    if (declared.cols || declared.rows) changed++;
    if (declared.cols && declared.rows) continue;
    if (list.length < 2) continue;
    let cols; try { cols = declared.cols ? [] : c.gridColumnSizes; } catch (e) { continue; }
    if (!cols) continue;
    // a lone column the members drew at different widths (a field in lists of 2, 3 or 4 columns)
    // flexes in a frame that stops hugging (FIXED keeps its width): each instance's width decides.
    // applyDeclared left it fixed because the grid hugged; a grid that hugged its content somewhere
    // (a chip) keeps hugging. A nested instance's column is its own main's (built a level below)
    if (c.type !== 'INSTANCE' && cols.length === 1 && !U(c, 'gc') && list.every((a) => a.layoutSizingHorizontal !== 'HUG')) {
      const ws = list.map((a) => a.width);
      if (Math.max(...ws) - Math.min(...ws) > 2) {
        try { c.layoutSizingHorizontal = 'FIXED'; c.gridColumnSizes = [{ type: 'FLEX', value: 1 }]; changed++; } catch (e) { gridWarnings++; }
      }
    }
    const seen = cols.length < 2 ? [] : list.map((a) => { try { return a.layoutMode === 'GRID' && a.gridColumnCount === cols.length ? a.gridColumnSizes.map((s) => s.value || 0) : null; } catch (e) { return null; } }).filter(Boolean);
    if (seen.length < 2) cols = [];
    const varies = cols.map((_, i) => Math.max(...seen.map((s) => s[i])) - Math.min(...seen.map((s) => s[i])) > 2);
    if (cols.length && varies.some(Boolean)) {
      const base = Math.min(...cols.filter((x, i) => varies[i]).map((x) => x.value || 1));
      try {
        c.gridColumnSizes = cols.map((x, i) => varies[i] ? { type: 'FLEX', value: Math.max(0.25, Math.round((x.value || base) / base * 4) / 4) } : { type: x.type, value: x.value });
        changed++;
      } catch (e) { gridWarnings++; }
    }
    // a row as tall as its content (one line of title here, two there) hugs it
    let rows; try { rows = declared.rows ? null : c.gridRowSizes; } catch (e) { rows = null; }
    if (rows && rows.length) {
      const seenR = list.map((a) => { try { return a.layoutMode === 'GRID' && a.gridRowCount === rows.length ? a.gridRowSizes.map((s) => s.value || 0) : null; } catch (e) { return null; } }).filter(Boolean);
      const vr = seenR.length >= 2 ? rows.map((_, i) => Math.max(...seenR.map((s) => s[i])) - Math.min(...seenR.map((s) => s[i])) > 2) : [];
      if (vr.some(Boolean)) {
        // a child that stretched to its row's height (cards of one row as tall as the tallest) has
        // nothing to fill in a hugging row and collapses: it hugs its own content instead
        for (const k of c.children) {
          try {
            if (vr[k.gridRowAnchorIndex] && k.layoutSizingVertical === 'FILL') {
              const al = k.type === 'INSTANCE' || (k.layoutMode === 'VERTICAL' || k.layoutMode === 'HORIZONTAL');
              k.layoutSizingVertical = al ? 'HUG' : 'FIXED';
            }
          } catch (e) {}
        }
        try { c.gridRowSizes = rows.map((x, i) => vr[i] ? { type: 'HUG' } : { type: x.type, value: x.value }); changed++; } catch (e) { gridWarnings++; }
      }
    }
  }
  return changed;
}
// does the grid take its length on this axis from its tracks (hug), rather than from a size of
// its own or its parent's cell?
const hugsGrid = (c, horizontal) => {
  const ls = horizontal ? c.layoutSizingHorizontal : c.layoutSizingVertical;
  if (ls === 'FILL' || ls === 'FIXED') return false;
  if (ls === 'HUG') return true;
  return horizontal ? c.primaryAxisSizingMode === 'AUTO' : c.counterAxisSizingMode === 'AUTO';
};
// a box that stops filling an axis hugs its content on it (a box without auto layout, and a text
// across its lines, keep the length they were drawn at). What filled that axis inside it would
// then close up with it (a status dot 9 px wide in a margin ended 1 px): each such layer hugs or
// keeps its drawn length too, all of them read before the first one changes
function holdLength(k, horizontal) {
  const key = horizontal ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
  const was = new Map();
  const note = (n) => { was.set(n, [n.width, n.height]); if ('children' in n && n.type !== 'INSTANCE') n.children.forEach(note); };
  note(k);
  const hold = (n) => {
    if (canHug(n) && (n.type !== 'TEXT' || !horizontal)) { n[key] = 'HUG'; return; }
    const [w, h] = was.get(n);
    n[key] = 'FIXED';
    n.resize(horizontal ? Math.max(w, 0.01) : n.width, horizontal ? n.height : Math.max(h, 0.01));
  };
  try { hold(k); } catch (e) {}
  const walk = (f) => {
    if (!('children' in f) || f.type === 'INSTANCE') return;
    if (hugsAxis(f, horizontal)) {
      const main = (f.layoutMode === 'HORIZONTAL') === horizontal;
      for (const c of f.children) {
        if (c.layoutPositioning === 'ABSOLUTE' || !was.has(c)) continue;
        if (c[key] !== 'FILL' && !(main && c.layoutGrow === 1)) continue;
        try { if (main) c.layoutGrow = 0; hold(c); } catch (e) {}
      }
    }
    for (const c of f.children) walk(c);
  };
  walk(k);
}
function applyDeclared(c) {
  trimGrid(c);
  const done = { cols: false, rows: false };
  let cols = null, rows = null;
  try { cols = declaredTracks(c, 'c', c.gridColumnCount); rows = declaredTracks(c, 'r', c.gridRowCount); } catch (e) { return done; }
  // a lone column is its grid's width (a 1fr or auto column of a block grid fills it)
  try { if (!cols && c.gridColumnCount === 1 && !hugsGrid(c, true)) cols = [{ type: 'FLEX', value: 1 }]; } catch (e) {}
  if (!cols && !rows) return done;
  // fixed tracks keep the px they were drawn at. A flexible track has nothing to share on an axis
  // the grid hugs (a hugging header grew to 16 000 px): an axis with a flexible track stops
  // hugging, its size stays and the track shares it
  const settle = (t, horizontal) => {
    const hug = hugsGrid(c, horizontal), px = horizontal ? c.gridColumnSizes : c.gridRowSizes;
    const code = U(c, horizontal ? 'gc' : 'gr') || '';
    const declaredFlex = /(^|,)f/.test(code);
    const drawn = t.map((x, i) => (px[i] ? { type: 'FIXED', value: px[i].value } : x));
    // auto tracks on an axis without fr (declared as fitting their content, or made to share the
    // free space of a grid that hugs): the browser sizes them by their content and then stretches
    // them over whatever room the box has of its own (align-content: normal). They fit their
    // content when that gives the length the grid was drawn at (a field whose value takes two
    // lines grows in its instance); else they share the room (a header 34 px tall centers its
    // 26 px of content; a label stretched to its 54 px row centers its two lines). Fixed px would
    // hold the drawn size but never let an instance grow
    // rows: auto rows read as weights (declaredTracks) are auto rows too — whether they stretch is
    // what the capture shows (packed below)
    const auto = t.map((x) => !declaredFlex && (x.type === 'HUG' || (x.type === 'FLEX' && (hug || !horizontal))));
    let out = t.map((x, i) => (x.type === 'FIXED' ? drawn[i] : auto[i] ? { type: 'HUG' } : x));
    if (auto.some(Boolean)) {
      const key = horizontal ? 'gridColumnSizes' : 'gridRowSizes', sizing = horizontal ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
      // how far the content reaches, not the frame's length: a min-height the capture kept (a
      // label 54 px tall around 35 px of lines) holds the frame at its drawn size either way
      const reach = () => {
        const kids = c.children.filter((k) => k.visible !== false && k.layoutPositioning !== 'ABSOLUTE');
        return kids.length ? Math.max(...kids.map((k) => (horizontal ? k.x + k.width : k.y + k.height))) + (horizontal ? c.paddingRight : c.paddingBottom) : 0;
      };
      const was = c[key], wasSizing = c[sizing], w0 = c.width, h0 = c.height;
      const cells = c.children.filter((k) => k.visible !== false && k.layoutPositioning !== 'ABSOLUTE');
      const at0 = cells.map((k) => (horizontal ? k.x : k.y));
      let fits = false, packed = false;
      try {
        c[key] = out;
        // packed: at the drawn size every cell still sits where the capture drew it, the room left
        // is after the last track (align-content: start — a person tile stretched to its row keeps
        // avatar and name at the top). Stretched tracks would have moved the later cells down
        packed = !horizontal && cells.length > 1 && cells.every((k, i) => Math.abs((horizontal ? k.x : k.y) - at0[i]) <= 1);
        if (wasSizing !== 'HUG') c[sizing] = 'HUG';
        fits = Math.abs(reach() - (horizontal ? w0 : h0)) <= 1;
      } catch (e) {}
      try {
        c[key] = was;
        if (c[sizing] !== wasSizing) c[sizing] = wasSizing;
        if (wasSizing === 'FIXED') c.resize(w0, h0);
      } catch (e) {}
      if (!fits && !packed) out = out.map((x, i) => (auto[i] ? (t[i].type === 'FLEX' ? t[i] : { type: 'FLEX', value: 1 }) : x));
    }
    // a flexible track shares the room of an axis that no longer hugs: its size stays
    if (out.some((x) => x.type === 'FLEX') && hug) {
      const w = c.width, h = c.height;
      try { if (horizontal) c.layoutSizingHorizontal = 'FIXED'; else c.layoutSizingVertical = 'FIXED'; } catch (e) {}
      try { c.resize(w, h); } catch (e) {}
    }
    return out;
  };
  // a cell that filled its track has nothing to fill once the track fits its content: it hugs its
  // own, or keeps the length it was drawn at (read before the track changes)
  const holdCells = (t, horizontal) => {
    for (const k of c.children) {
      const x = t[horizontal ? k.gridColumnAnchorIndex : k.gridRowAnchorIndex];
      if (x && x.type === 'HUG' && k[horizontal ? 'layoutSizingHorizontal' : 'layoutSizingVertical'] === 'FILL') holdLength(k, horizontal);
    }
  };
  try {
    if (cols) { const t = settle(cols, true); holdCells(t, true); c.gridColumnSizes = t; done.cols = true; }
  } catch (e) { gridWarnings++; }
  try {
    if (rows) { const r = settle(rows, false); holdCells(r, false); c.gridRowSizes = r; done.rows = true; }
  } catch (e) { gridWarnings++; }
  trimGrid(c);
  return done;
}
// the changing run of a grid's cells, all in one row (or one column): an auto layout frame that
// spans those cells, so the grid's tracks go on sizing everything (a header's 1fr | 360px | 1fr
// keeps its search centered whether the slot brought a search or a spacer)
function gridSlot(P, spec, name) {
  const run = P.children.slice(spec.pre, P.children.length - spec.post).filter((c) => c.layoutPositioning !== 'ABSOLUTE');
  if (!run.length) return null;
  let cells;
  try { cells = run.map((c) => ({ c, r: c.gridRowAnchorIndex, col: c.gridColumnAnchorIndex, rs: c.gridRowSpan, cs: c.gridColumnSpan })); } catch (e) { return null; }
  const oneRow = cells.every((k) => k.r === cells[0].r && k.rs === 1), oneCol = cells.every((k) => k.col === cells[0].col && k.cs === 1);
  if (!oneRow && !oneCol) return null;
  const H = oneRow;
  let tracks = null; try { tracks = H ? P.gridColumnSizes : P.gridRowSizes; } catch (e) {}
  const from = Math.min(...cells.map((k) => (H ? k.col : k.r))), to = Math.max(...cells.map((k) => (H ? k.col + k.cs : k.r + k.rs)));
  const al = cells.map((k) => (H ? k.c.gridChildVerticalAlign : k.c.gridChildHorizontalAlign));
  const cross = al.every((a) => a === 'CENTER') ? 'CENTER' : al.every((a) => a === 'MAX') ? 'MAX' : 'MIN';
  const S = figma.createFrame();
  S.name = name; S.fills = []; S.clipsContent = false;
  S.layoutMode = H ? 'HORIZONTAL' : 'VERTICAL';
  S.itemSpacing = (H ? P.gridColumnGap : P.gridRowGap) || 0;
  try { S.counterAxisAlignItems = cross; } catch (e) {}
  const sizes = run.map((c) => [c.width, c.height]);
  // what each cell's track was in the stylesheet (read-tags gc/gr): only a declared 1fr grows. An
  // auto track the capture (or declaredTracks, sharing a stretched grid's room) made flexible
  // fits its content: auto layout has no weights, and two filling cells split the slot in halves
  // (a team tile's title row took half the tile and pushed its members out of it)
  const code = U(P, H ? 'gc' : 'gr') || '';
  const codes = code === '*h' ? null : code ? code.split(',') : null;
  const kinds = cells.map((k) => {
    const i = H ? k.col : k.r, t = tracks && tracks[i];
    if (code === '*h' || (codes && codes[i] === 'h')) return 'HUG';
    if (codes && codes[i] && codes[i][0] === 'x') return 'FIXED';
    return t ? t.type : 'FIXED';
  });
  let rowsBefore = 1, colsBefore = 1; try { rowsBefore = P.gridRowCount; colsBefore = P.gridColumnCount; } catch (e) {}
  // the cells leave the grid first: a frame can't take cells that are still held (the failed
  // attempt also left a phantom row behind, and the grid hugged it)
  for (const c of run) S.appendChild(c);
  P.insertChild(spec.pre, S);
  try {
    S.setGridChildPosition(H ? cells[0].r : from, H ? from : cells[0].col);
    if (H) S.gridColumnSpan = to - from; else S.gridRowSpan = to - from;
    S.layoutSizingHorizontal = 'FILL'; S.layoutSizingVertical = 'FILL';
  } catch (e) {
    run.forEach((c, i) => { P.insertChild(spec.pre + i, c); try { c.setGridChildPosition(cells[i].r, cells[i].col); c.gridRowSpan = cells[i].rs; c.gridColumnSpan = cells[i].cs; } catch (e2) {} });
    S.remove();
    try { P.gridRowCount = rowsBefore; P.gridColumnCount = colsBefore; } catch (e2) {}
    trimGrid(P);
    return null;
  }
  try { if (P.gridRowCount > rowsBefore) P.gridRowCount = rowsBefore; if (P.gridColumnCount > colsBefore) P.gridColumnCount = colsBefore; } catch (e) {}
  trimGrid(P);
  run.forEach((c, i) => {
    try {
      // along the run each cell keeps what its track did: 1fr grows, auto fits, px stays
      const along = H ? 'layoutSizingHorizontal' : 'layoutSizingVertical', across = H ? 'layoutSizingVertical' : 'layoutSizingHorizontal';
      c[along] = kinds[i] === 'FLEX' ? 'FILL' : kinds[i] === 'HUG' && canHug(c) ? 'HUG' : 'FIXED';
      const spans = Math.abs((H ? c.height : c.width) - (H ? P.height - P.paddingTop - P.paddingBottom : P.width - P.paddingLeft - P.paddingRight)) <= FILL_TOL;
      c[across] = spans ? 'FILL' : c.type === 'TEXT' ? 'HUG' : 'FIXED';
      if (c[along] === 'FIXED' || c[across] === 'FIXED') c.resize(c.layoutSizingHorizontal === 'FIXED' ? sizes[i][0] : c.width, c.layoutSizingVertical === 'FIXED' ? sizes[i][1] : c.height);
    } catch (e) {}
  });
  SET(S, 'slotWrap', '1');
  SET(S, 'kinds', JSON.stringify(kinds));
  spec.slotPath = spec.path.concat(spec.pre); spec.wrap = true;
  return S;
}
// the slot frame of a main: the path frame itself when the whole of it changes, else a new
// frame around the changing run (same direction and gap as its parent)
function makeSlot(comp, spec, name) {
  const P = nodeAt(comp, spec.path);
  if (!P || !('children' in P)) return null;
  const whole = spec.pre === 0 && spec.post === 0 && spec.path.length > 0;
  // a run of cells in a container's grid keeps the grid: the slot spans their tracks (1fr, 360px,
  // 1fr stay). A list's rows leave it: a column of rows is a stack and equal cards wrap (a grid slot
  // kept the capture's 10 row tracks around 5 rows, and every other row count was a new variant)
  if (P.layoutMode === 'GRID' && !whole && !spec.list) { const G = gridSlot(P, spec, name); if (G) return G; }
  if (P.layoutMode === 'GRID' && !unGrid(P)) return null;
  if (whole) { spec.slotPath = spec.path.slice(); spec.wrap = false; return P; }
  if (P.layoutMode === 'NONE' && !(spec.pre === 0 && spec.post === 0)) return null;
  const S = figma.createFrame();
  S.name = name; S.fills = []; S.clipsContent = false;
  const run = P.children.slice(spec.pre, P.children.length - spec.post);
  if (P.layoutMode === 'NONE') {
    S.resize(Math.max(P.width, 1), Math.max(P.height, 1));
    P.insertChild(spec.pre, S); S.x = 0; S.y = 0;
    for (const c of run) { const x = c.x, y = c.y; S.appendChild(c); c.x = x; c.y = y; }
  } else {
    // the run's width: rows that filled their parent fill the slot; rows wider than a box that
    // scrolls sideways (a table in a narrow panel) keep their width, and the slot takes it
    const inner = P.layoutMode === 'VERTICAL' ? P.width - P.paddingLeft - P.paddingRight : P.height - P.paddingTop - P.paddingBottom;
    const across = run.map((c) => (P.layoutMode === 'VERTICAL' ? c.width : c.height));
    // the slot fills its parent when its widest child did (a short note next to a full-width list)
    const widest = Math.max(...across, 0);
    const fills = Math.abs(widest - inner) <= FILL_TOL;
    // along the run: children that share the row (flex: 1) need a slot that fills it; children that
    // grew to share a fixed height keep their measured height (the slot hugs them)
    const alongKey = P.layoutMode === 'HORIZONTAL' ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
    const share = run.some((c) => c[alongKey] === 'FILL' || c.layoutGrow === 1) || (P.primaryAxisAlignItems === 'SPACE_BETWEEN' && run.length > 1);
    const sizes = run.map((c) => [c.width, c.height]);
    S.layoutMode = P.layoutMode;
    S.itemSpacing = P.itemSpacing;
    try { S.layoutWrap = P.layoutWrap; S.counterAxisSpacing = P.counterAxisSpacing; } catch (e) {}
    // a run spread over its row (space-between) keeps spreading: the slot fills and spreads it
    const spread = P.primaryAxisAlignItems === 'SPACE_BETWEEN' && run.length > 1;
    S.primaryAxisAlignItems = P.primaryAxisAlignItems === 'SPACE_BETWEEN' && !spread ? 'MIN' : P.primaryAxisAlignItems;
    S.counterAxisAlignItems = P.counterAxisAlignItems;
    // a free layer (a mark on a timeline) stays where the page drew it: its x/y were relative to P,
    // and the slot sits inside P's padding (a bordered box put it 1 px off on each axis)
    const free = run.filter((c) => c.layoutPositioning === 'ABSOLUTE').map((c) => [c, c.absoluteTransform[0][2], c.absoluteTransform[1][2]]);
    P.insertChild(spec.pre, S);
    for (const c of run) {
      const k = { h: c.layoutSizingHorizontal, v: c.layoutSizingVertical };
      S.appendChild(c);
      try { c.layoutSizingHorizontal = k.h; } catch (e) {}
      try { c.layoutSizingVertical = k.v; } catch (e) {}
    }
    try {
      const w = Math.max(...across, 1);
      if (P.layoutWrap === 'WRAP') {
        // cards that wrap into rows need the row's width to wrap at, and as many rows as they make
        S.layoutSizingHorizontal = 'FILL'; S.layoutSizingVertical = 'HUG';
      } else if (P.layoutMode === 'VERTICAL') {
        if (fills) S.layoutSizingHorizontal = 'FILL'; else { S.resize(w, S.height); S.layoutSizingHorizontal = 'FIXED'; }
        S.layoutSizingVertical = 'HUG';
        if (share) run.forEach((c, i) => { try { c.layoutGrow = 0; c.layoutSizingVertical = 'FIXED'; c.resize(c.width, sizes[i][1]); } catch (e) {} });
      } else {
        S.layoutSizingHorizontal = share ? 'FILL' : 'HUG';
        if (fills) S.layoutSizingVertical = 'FILL'; else { S.resize(S.width, w); S.layoutSizingVertical = 'FIXED'; }
      }
    } catch (e) {}
    // once the slot has its size and place (re-parenting can also drop the absolute positioning).
    // All of them leave the flow first: one that was still in it sized a hugging slot, and a slot
    // centered in its parent moves as it shrinks, so its place is read once, after the last
    for (const [c] of free) { try { c.layoutPositioning = 'ABSOLUTE'; } catch (e) {} }
    const sx = S.absoluteTransform[0][2], sy = S.absoluteTransform[1][2];
    for (const [c, ax, ay] of free) { try { c.x = ax - sx; c.y = ay - sy; } catch (e) {} }
  }
  SET(S, 'slotWrap', '1');
  spec.slotPath = spec.path.concat(spec.pre); spec.wrap = true;
  return S;
}
// a border that takes room in the layout (strokesIncludedInLayout, the CSS box's border) counts
// with the padding: a bordered card is its content plus 1 px on each side, and still hugs it
function borderIn(f, horizontal) {
  if (!f.strokesIncludedInLayout || !Array.isArray(f.strokes) || !f.strokes.some((p) => p.visible !== false)) return 0;
  const w = (side) => { const k = 'stroke' + side + 'Weight'; return typeof f[k] === 'number' ? f[k] : typeof f.strokeWeight === 'number' ? f.strokeWeight : 0; };
  return horizontal ? w('Left') + w('Right') : w('Top') + w('Bottom');
}
// how long a frame's content is along an axis: a child that fills counts with its own content's
// length (it would shrink with the frame); null when that can't be told (a grid, free layers, wrap)
function need(f, horizontal) {
  if (f.type === 'TEXT') return horizontal ? f.width : f.height;
  if (!('layoutMode' in f) || (f.layoutMode !== 'VERTICAL' && f.layoutMode !== 'HORIZONTAL') || f.layoutWrap === 'WRAP') return null;
  const along = (f.layoutMode === 'HORIZONTAL') === horizontal;
  const pad = (horizontal ? f.paddingLeft + f.paddingRight : f.paddingTop + f.paddingBottom) + borderIn(f, horizontal);
  const ls = [];
  for (const c of f.children) {
    if (c.visible === false || c.layoutPositioning === 'ABSOLUTE') continue;
    const fill = (horizontal ? c.layoutSizingHorizontal : c.layoutSizingVertical) === 'FILL' || (along && c.layoutGrow === 1);
    if (!fill) { ls.push(horizontal ? c.width : c.height); continue; }
    const n = need(c, horizontal);
    if (n === null) return null;
    ls.push(n);
  }
  if (!ls.length) return pad;
  return pad + (along ? ls.reduce((a, b) => a + b, 0) + f.itemSpacing * (ls.length - 1) : Math.max(...ls));
}
// the page sized this frame by its content along an axis (not a size of its own, not stretched by
// its parent)
const driven = (f, horizontal) => { const n = need(f, horizontal); return n !== null && Math.abs(n - (horizontal ? f.width : f.height)) <= 1.5; };
// On the way up from the slot, the frames the page sized by their content: they keep hugging, so a
// main with five rows is the height of five rows. Read before the list drops its extra rows. A box
// that scrolls, a grid, or a frame with a size of its own (a 34 px header whose content is 26 px)
// keeps its size on that axis, and so does everything above it. The width hugs only where the page
// hugged it too (a tab bar as wide as its tabs; the root's own sizing is read from the capture,
// repHugsH, since the main was fixed at the rep's size) and never on a box whose items wrap: they
// need a width to wrap at
function hugPlan(comp, spec, repHugsH) {
  const plan = [];
  let v = true, h = true;
  for (let d = spec.slotPath.length; d >= 0 && (v || h); d--) {
    const f = nodeAt(comp, spec.slotPath.slice(0, d));
    if (!f || !('layoutMode' in f) || f.layoutMode === 'GRID' || f.layoutMode === 'NONE') break;
    const scroll = U(f, 'scroll');
    v = v && !/y/.test(scroll) && (driven(f, false) || f.layoutWrap === 'WRAP');
    h = h && !/x/.test(scroll) && f.layoutWrap !== 'WRAP' && driven(f, true) && (f === comp ? repHugsH : f.layoutSizingHorizontal === 'HUG');
    if (v || h) plan.push({ f, v, h });
  }
  return plan;
}
function hugUp(comp, plan) {
  for (const { f, v, h } of plan) {
    const nested = f !== comp && f.parent && f.parent.layoutMode && f.parent.layoutMode !== 'NONE';
    if (v) {
      try {
        if (f.layoutMode === 'VERTICAL') f.primaryAxisSizingMode = 'AUTO'; else f.counterAxisSizingMode = 'AUTO';
        if (nested) f.layoutSizingVertical = 'HUG';
      } catch (e) {}
    }
    if (h) {
      try {
        if (f.layoutMode === 'HORIZONTAL') f.primaryAxisSizingMode = 'AUTO'; else f.counterAxisSizingMode = 'AUTO';
        if (nested) f.layoutSizingHorizontal = 'HUG';
      } catch (e) {}
    }
  }
}
// a frame whose items wrap takes as many lines as they make: a header whose meta drops to a second
// line on a narrow screen grows instead of spilling out of a fixed height. Not a box that scrolls
// (a gallery keeps its viewport), nor one its parent stretched (chips centered next to an avatar
// would move up as it shrank): their height does not come from their items
function hugWraps(root) {
  const walk = (f) => {
    if (!('children' in f) || f.type === 'INSTANCE') return;
    if (f.layoutWrap === 'WRAP' && !/y/.test(U(f, 'scroll')) && f.layoutSizingVertical !== 'FILL') {
      try {
        f.counterAxisSizingMode = 'AUTO';
        if (f !== root && f.parent.layoutMode && f.parent.layoutMode !== 'NONE') f.layoutSizingVertical = 'HUG';
      } catch (e) {}
    }
    for (const c of f.children) walk(c);
  };
  walk(root);
}

// how the main resizes, read from how the page laid it out (CSS block boxes fill their column,
// flex rows put the last item on the right): a child as wide as its column fills it; in a frame
// without auto layout, a child on the right side is anchored to the right edge
// a box's border takes room in CSS and none in Figma's auto layout: a child that filled its column
// comes out up to 1 px narrower per side, so 'as wide as' allows 2.5 px (4 took a 24 px tool for
// the 28 px row it sat in)
const FILL_TOL = 2.5;
function inferSizing(root) {
  let n = 0;
  const walk = (f) => {
    if (!('children' in f) || f.type === 'INSTANCE') return;
    const lm = f.layoutMode;
    if (lm === 'VERTICAL' || lm === 'HORIZONTAL') {
      const innerW = f.width - f.paddingLeft - f.paddingRight, innerH = f.height - f.paddingTop - f.paddingBottom;
      // a child can't fill an axis its parent hugs: the parent would then take its size from the child
      // and both collapse (a 34 px tool row hugging tools that fill it ended 7 px tall)
      const hugW = hugsAxis(f, true), hugH = hugsAxis(f, false);
      for (const c of f.children) {
        if (c.layoutPositioning === 'ABSOLUTE') continue;
        try {
          if (lm === 'VERTICAL' && !hugW && c.layoutSizingHorizontal === 'FIXED' && Math.abs(c.width - innerW) <= FILL_TOL) {
            if (c.type === 'TEXT' && c.textAutoResize === 'WIDTH_AND_HEIGHT') c.textAutoResize = 'HEIGHT';
            c.layoutSizingHorizontal = 'FILL'; n++;
          }
          if (lm === 'HORIZONTAL' && !hugH && c.type !== 'TEXT' && c.layoutSizingVertical === 'FIXED' && Math.abs(c.height - innerH) <= FILL_TOL) { c.layoutSizingVertical = 'FILL'; n++; }
        } catch (e) {}
      }
    } else if (lm === 'GRID') {
      // a cell's content as wide as its column fills it, so a wider column (a flexible track) widens
      // it. As wide as the column the page drew (gpx: a track made flexible has no px of its own);
      // content the page centered or pushed to the end of its cell (a 22 px avatar in a 26 px
      // column) keeps its size and its alignment. A column that fits its content has nothing to
      // fill: a cell filling it closes up (a status dot's margin went from 15 px to its padding)
      let cols = null; try { cols = f.gridColumnSizes; } catch (e) {}
      let px = null; try { px = JSON.parse(U(f, 'gpx') || 'null'); } catch (e) {}
      for (const c of f.children) {
        if (c.layoutPositioning === 'ABSOLUTE' || !cols) continue;
        const tr = cols[c.gridColumnAnchorIndex];
        if (!tr || tr.type === 'HUG' || c.gridColumnSpan !== 1 || c.gridChildHorizontalAlign === 'CENTER' || c.gridChildHorizontalAlign === 'MAX') continue;
        const drawn = (px && px.c && px.c[c.gridColumnAnchorIndex]) || (tr.type === 'FIXED' ? tr.value : null);
        if (drawn ? Math.abs(c.width - drawn) <= FILL_TOL : tr.type === 'FLEX' && c.layoutSizingHorizontal === 'FIXED') {
          try { if (c.type === 'TEXT' && c.textAutoResize === 'WIDTH_AND_HEIGHT') c.textAutoResize = 'HEIGHT'; c.layoutSizingHorizontal = 'FILL'; n++; } catch (e) {}
        }
      }
    } else if (lm === 'NONE' || lm === undefined) {
      // anchor right only what the page pushed to the right edge, away from the rest of its line
      // (a count at the end of a header); text that flows after its neighbor (a breadcrumb)
      // stays anchored left
      for (const c of f.children) {
        if (!('constraints' in c)) continue;
        const l = c.x, r = f.width - c.x - c.width;
        const line = f.children.filter((s) => s !== c && s.y < c.y + c.height && s.y + s.height > c.y && s.x + s.width <= c.x + 1);
        const gap = line.length ? c.x - Math.max(...line.map((s) => s.x + s.width)) : l;
        let h = 'MIN';
        if (c.width >= f.width - 2) h = 'STRETCH';
        else if (r <= 4 && line.length && gap > 24) h = 'MAX';
        else if (Math.abs(l - r) < 2 && l > 2 && !line.length) h = 'CENTER';
        try { c.constraints = { horizontal: h, vertical: c.constraints.vertical }; n++; } catch (e) {}
      }
    }
    for (const c of f.children) {
      // a fixed text box keeps the rep's size for every other text: a one-line label gets auto width
      // (a longer crumb no longer clips), a paragraph auto height; a truncated one (…) stays fixed
      if (c.type === 'TEXT' && c.textAutoResize === 'NONE' && c.textTruncation !== 'ENDING') {
        const fs = c.fontSize === figma.mixed ? 14 : c.fontSize;
        try { c.textAutoResize = c.height < fs * 1.9 ? 'WIDTH_AND_HEIGHT' : 'HEIGHT'; n++; } catch (e) {}
      }
      walk(c);
    }
  };
  walk(root);
  return n;
}
// a frame that hugs its content along an axis can't have a child that fills that axis: Figma then
// keeps the main's size in every instance and the filling child takes the slack (a subtitle that
// grows into a gap when the instance has fewer rows). Such children keep their measured size.
function settle(root) {
  let n = 0;
  const walk = (f) => {
    if (!('children' in f) || f.type === 'INSTANCE') return;
    const lm = f.layoutMode;
    if (lm === 'VERTICAL' || lm === 'HORIZONTAL') {
      const hugsMain = f.primaryAxisSizingMode === 'AUTO', hugsCross = f.counterAxisSizingMode === 'AUTO';
      const mainKey = lm === 'VERTICAL' ? 'layoutSizingVertical' : 'layoutSizingHorizontal';
      const crossKey = lm === 'VERTICAL' ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
      for (const c of f.children) {
        if (c.layoutPositioning === 'ABSOLUTE') continue;
        const al = 'layoutMode' in c && (c.layoutMode === 'VERTICAL' || c.layoutMode === 'HORIZONTAL');
        try {
          if (hugsMain && (c.layoutGrow === 1 || c[mainKey] === 'FILL')) { const w = c.width, h = c.height; c.layoutGrow = 0; c[mainKey] = al ? 'HUG' : 'FIXED'; if (!al) c.resize(w, h); n++; }
          if (hugsCross && c[crossKey] === 'FILL') { const w = c.width, h = c.height; c[crossKey] = al ? 'HUG' : 'FIXED'; if (!al) c.resize(w, h); n++; }
        } catch (e) {}
      }
    }
    for (const c of f.children) if (!U(c, 'slotFrame')) walk(c);
  };
  walk(root);
  return n;
}
// a text that wraps on some screen wraps in the main (a note one line long in the rep ran past its
// box on every screen where it takes three): drawn over several lines in a box of fixed width, or
// across its parent's whole width, it gets auto height and fills its parent's width. A parent that
// hugs its width has none to give: the text hugs its own up to the widest the page drew it, and
// wraps past that (fixed at the rep's width, a one-digit value set every other value one
// character per line). A rep whose own text wraps already has the width the page wrapped it at,
// and inferSizing read it from there
const manyLines = (t) => t.height >= (t.fontSize === figma.mixed ? 14 : t.fontSize) * 1.9;
const spansParent = (t) => { const P = t.parent; return !!P && 'paddingLeft' in P && Math.abs(t.width - (P.width - P.paddingLeft - P.paddingRight)) <= FILL_TOL; };
const wraps = (a) => a.type === 'TEXT' && manyLines(a) && (a.textAutoResize === 'HEIGHT' || a.textAutoResize === 'NONE' || spansParent(a));
async function wrapTexts(parts, partOf) {
  let n = 0;
  for (const [b, list] of parts) {
    const t = partOf(b);
    if (!t || t.type !== 'TEXT' || t.textTruncation === 'ENDING' || wraps(b) || !list.some(wraps)) continue;
    const P = t.parent;
    const widest = Math.max(t.width, ...list.filter((a) => a.type === 'TEXT').map((a) => a.width));
    const auto = P.layoutMode && P.layoutMode !== 'NONE';
    try {
      await loadFontsOf(t);
      if (auto && !(P.layoutMode === 'GRID' ? hugsGrid(P, true) : hugsAxis(P, true))) { t.textAutoResize = 'HEIGHT'; t.layoutSizingHorizontal = 'FILL'; }
      else if (auto && P.layoutMode !== 'GRID') { t.textAutoResize = 'WIDTH_AND_HEIGHT'; t.maxWidth = widest; }
      else { t.textAutoResize = 'HEIGHT'; t.resize(widest, t.height); }
      n++;
    } catch (e) {}
    // the boxes around it grow with its lines: each one up the main whose height is its content's
    // (not stretched by its row) hugs it (a bar label's box held its row at one line)
    for (let A = P; A && A.type !== 'COMPONENT' && 'layoutMode' in A && A.layoutMode !== 'NONE' && A.layoutSizingVertical === 'FIXED'; A = A.parent) {
      const h0 = A.height;
      try {
        A.layoutSizingVertical = 'HUG';
        if (Math.abs(A.height - h0) > 1.5) { A.layoutSizingVertical = 'FIXED'; A.resize(A.width, h0); break; }
      } catch (e) { break; }
    }
  }
  return n;
}
// a size limit the members don't share (a note's max-width of 72ch on the dossier, none in a card)
// would clamp every instance: the main keeps a limit only when every member drew the same one
function looseLimits(parts, partOf) {
  for (const [b, list] of parts) {
    const d = partOf(b);
    if (!d) continue;
    for (const k of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight']) {
      if (!(k in d) || d[k] === null) continue;
      const vs = list.map((a) => (k in a ? a[k] : null));
      if (vs.every((v) => typeof v === 'number') && Math.max(...vs) - Math.min(...vs) <= 1) continue;
      try { d[k] = null; } catch (e) {}
    }
  }
}
// a main standing in a set keeps its own size: sizing copied from its screen (fill, grow) would
// make it collapse inside the set's auto layout
function standAlone(c, hugsV, hugsH) {
  try { c.layoutGrow = 0; } catch (e) {}
  try { c.layoutAlign = 'INHERIT'; } catch (e) {}
  try { c.layoutSizingHorizontal = hugsH ? 'HUG' : 'FIXED'; } catch (e) {}
  try { c.layoutSizingVertical = hugsV ? 'HUG' : 'FIXED'; } catch (e) {}
}
// can this spec become a slot? a slot can't be a many-row-many-column grid, and a run of children
// can't be cut out of a frame without auto layout (their positions would be lost)
function feasible(rep, spec) {
  const P = nodeAt(rep, spec.path);
  if (!P || !('children' in P)) return false;
  if (P.layoutMode === 'GRID') {
    try {
      if (P.gridRowCount > 1 && P.gridColumnCount > 1) {
        // equal columns of single cells wrap (unGrid); any other many-row grid can't hold a slot
        const k = P.children.filter((c) => c.layoutPositioning !== 'ABSOLUTE');
        if (!k.length || !k.every((c) => c.gridRowSpan === 1 && c.gridColumnSpan === 1 && Math.abs(c.width - k[0].width) <= 1)) return false;
      }
    } catch (e) { return false; }
  }
  if (P.layoutMode === 'NONE' && !(spec.pre === 0 && spec.post === 0)) return false;
  return true;
}
// where no slot can go, a list is its structures: only identical ones share a variant (a grid of
// four fields is not a grid of eight with four hidden: hidden cells still hold their tracks)
const sameKids = (o, r) => sameCols(o, r) && 'children' in o && 'children' in r && o.children.length === r.children.length && !!pick(o.children, r.children);
// does a cell of some member hold free layers (ABSOLUTE) that sit elsewhere than in its rep's
// (marks on a timeline row, a bar that starts on another day)? An instance never takes positions,
// so such a cell is content. Only what cellSpec can make a slot of counts: a layer placed on the
// row itself (a centered badge) or in a grid cell can't travel in a cell slot, and on its own it
// must not turn a row's optional parts into slots
const slotCell = (n) => n.type === 'FRAME' && n.layoutMode !== 'GRID';
function positionsVary(reps) {
  return reps.some((r) => r.members.some((m) => m !== r.rep && [...mapRoot(m, r.rep)].some(([a, b]) => a.parent === m && slotCell(b) && !samePlace(a, b))));
}
// reps whose grids declared the same columns (fitsRoot kept the others apart; a cell spec must too)
function byCols(reps) {
  const groups = [];
  for (const r of reps) { const g = groups.find((x) => sameCols(r.rep, x[0].rep)); if (g) g.push(r); else groups.push([r]); }
  return groups;
}

const report = {};
// resumable: past the budget no new component starts; the rest comes back in _pending and the
// same call runs again (the ones built are skipped)
const BUDGET = PARAMS.budgetMs || 40000;
for (const [idx, ui] of PARAMS.ui.entries()) {
  await breathe();
  if (idx && Date.now() - T0 > BUDGET) { report._pending = PARAMS.ui.slice(idx); break; }
  if (owners[ui]) { report[ui] = { exists: owners[ui].id }; continue; }
  const list = occ[ui] || [];
  if (!list.length) { report[ui] = { occurrences: 0 }; continue; }
  const kind = kindOf(ui), row = PARAMS.lists[ui] || null;
  const groups = {};
  for (const n of list) (groups[U(n, 'props')] = groups[U(n, 'props')] || []).push(n);
  const plan = [];
  for (const [props, l] of Object.entries(groups).sort()) {
    const sorted = l.slice().sort((a, b) => size(b) - size(a));
    const exact = (l) => {
      const reps = [];
      for (const o of l) { const r = reps.find((x) => sameKids(o, x.rep)); if (r) r.members.push(o); else reps.push({ rep: o, members: [o] }); }
      for (const r of reps) plan.push({ props, rep: r.rep, members: r.members, spec: null, exact: true });
    };
    if (kind === 'list' && row) {
      let rest = sorted;
      while (rest.length) {
        const rep = rest[0], spec = listSpec(rep, row);
        if (!spec || !feasible(rep, spec)) { const same0 = rest.filter((o) => sameKids(o, rep)); exact(same0); rest = rest.filter((o) => !same0.includes(o)); continue; }
        const fit = rest.filter((o) => o === rep || chromeFits(o, rep, spec));
        plan.push({ props, rep, members: fit, spec });
        rest = rest.filter((o) => !fit.includes(o));
      }
    } else if (kind === 'container' && (sorted.length === 1 ? 'children' in sorted[0] && sorted[0].children.length : containerSpec(sorted))) {
      // one occurrence says nothing about what is fixed: all its content goes to the slot
      const spec = sorted.length === 1 ? { path: [], pre: 0, post: 0 } : containerSpec(sorted);
      if (feasible(sorted[0], spec)) plan.push({ props, rep: sorted[0], members: sorted, spec });
      else exact(sorted);
    } else {
      const reps = [];
      for (const o of sorted) { const r = reps.find((x) => fitsRoot(o, x.rep)); if (r) r.members.push(o); else reps.push({ rep: o, members: [o] }); }
      // many structures of the same row, or parts that sit elsewhere on every line: its cells
      // become slots when every line has the same cells
      for (const g of byCols(reps)) {
        const members = sorted.filter((o) => g.some((r) => r.members.includes(o)));
        const cs = g.length > 3 || positionsVary(g) ? cellSpec(members) : null;
        if (cs) plan.push({ props, rep: members[0], members, spec: cs });
        else for (const r of g) plan.push({ props, rep: r.rep, members: r.members, spec: null });
      }
    }
  }
  const perProps = {};
  for (const p of plan) perProps[p.props] = (perProps[p.props] || 0) + 1;
  const needTipo = Object.values(perProps).some((v) => v > 1);
  const hasProps = plan.some((p) => p.props.trim());
  const count = {};
  const created = [];
  let x = PARAMS.origin[0];
  const slotName = kind === 'list' ? 'Rows' : 'Content';
  for (const p of plan) {
    await breathe();
    const clone = p.rep.clone();
    compPage.appendChild(clone);
    const twin = twinOf(p.rep, clone);
    // every grid of the main remembers the shape it had in the capture: the swap compares
    // occurrences against it once the slot or the auto layout has changed the live grid. And the
    // px its tracks were drawn at (gpx): a track made flexible has none of its own left
    const px = (tracks) => tracks.map((s) => (s.type === 'FIXED' ? s.value : null));
    for (const [raw, cl] of twin) {
      if (raw.layoutMode !== 'GRID' || cl.type === 'INSTANCE') continue;
      SET(cl, 'gsig', gridSig(raw));
      try { SET(cl, 'gpx', JSON.stringify({ c: px(raw.gridColumnSizes), r: px(raw.gridRowSizes) })); } catch (e) {}
    }
    // a capture's grid can carry empty trailing tracks (auto-fill leftovers): the counts drop to the cells
    { const walk = (n) => { if (n.type === 'INSTANCE') return; if (n.layoutMode === 'GRID') trimGrid(n); for (const k of n.children || []) walk(k); }; walk(clone); }
    // sizes from the members: flexible columns where they differ
    const maps = p.members.map((m) => p.spec ? mapChrome(m, p.rep, p.spec) : mapRoot(m, p.rep));
    const mapped = byPart(maps);
    const flexed = flexFrom(mapped, twin);
    // optional parts: rep parts that some member lacks (one or two levels down)
    const optional = [];
    if (!p.spec && p.members.length > 1) {
      const hits = maps.map((mp) => new Set(mp.values()));
      const walk = (n, depth) => {
        if (n !== p.rep && hits.some((h) => !h.has(n))) { optional.push(n); return; }
        if (depth < 2 && 'children' in n && n.type !== 'INSTANCE') for (const c of n.children) walk(c, depth + 1);
      };
      walk(p.rep, 0);
    }
    clone.x = x; clone.y = cursorY; x += clone.width + 40;
    const size0 = [p.rep.width, p.rep.height];
    // whether the page sized the rep's width by its content, read before the main is fixed below
    const repHugsH = p.rep.layoutSizingHorizontal === 'HUG';
    const comp = figma.createComponentFromNode(clone);
    // the main's part for a rep part (the clone's root is now the component)
    const partOf = (b) => (b === p.rep ? comp : twin.get(b));
    looseLimits(mapped, partOf);
    count[p.props] = (count[p.props] || 0) + 1;
    const parts = [];
    if (p.props.trim()) parts.push(variantName(p.props));
    if (needTipo) parts.push('tipo=' + count[p.props]);
    comp.name = parts.join(', ') || ui;
    SET(comp, 'props', p.props);
    SET(comp, 'match', p.exact ? 'exact' : '');
    SET(comp, 'members', String(p.members.length));
    // keep the on-screen size (a hugging box can collapse once it stands alone)
    try {
      if (comp.layoutMode === 'HORIZONTAL' || comp.layoutMode === 'VERTICAL') { comp.primaryAxisSizingMode = 'FIXED'; comp.counterAxisSizingMode = 'FIXED'; }
      comp.resize(Math.max(size0[0], 0.01), Math.max(size0[1], 0.01));
    } catch (e) {}
    // a slot text's CSS floor goes on the main before anything is sized: a row that wraps its
    // meta where the browser did needs it, and an instance can't override a min width
    for (const [slot, w] of Object.entries((PARAMS.minW || {})[ui] || {})) {
      // the slot's tagged box, or the layer at the slot's place in the page, if it is a text (or holds one)
      let box = comp.findOne((n) => U(n, 'slot') === slot);
      if (!box) { const at = nodeAt(comp, w.path || []); if (at && at !== comp && (at.type === 'TEXT' || (at.type === 'FRAME' && at.children.length === 1 && at.children[0].type === 'TEXT'))) box = at; }
      if (box && box.parent && box.parent.layoutMode && box.parent.layoutMode !== 'NONE') { try { box.minWidth = w.px; } catch (e) {} }
    }
    // a clipped box of several text lines is a line clamp (`-webkit-line-clamp`): the capture froze
    // it at this occurrence's lines, and an instance with a one-line title kept the two-line box
    // (its meta pushed under the row's edge). It hugs up to those lines and the text ends in "…"
    for (const f of comp.findAll((n) => n.type === 'FRAME' && n.clipsContent && n.children.length === 1 && n.children[0].type === 'TEXT')) {
      const t = f.children[0];
      if (!f.layoutMode || f.layoutMode === 'NONE' || f.layoutSizingVertical !== 'FIXED' || Math.abs(f.height - t.height) >= 3) continue;
      const lh = t.lineHeight && t.lineHeight.unit === 'PIXELS' ? t.lineHeight.value : t.fontSize * 1.2;
      const lines = Math.round(t.height / lh);
      if (lines < 2) continue;
      try { await loadFontsOf(t); const h = f.height; t.textTruncation = 'ENDING'; t.maxLines = lines; f.layoutSizingVertical = 'HUG'; f.maxHeight = h; } catch (e) {}
    }
    p.sized = inferSizing(comp) + growItems(mapped, partOf) + await wrapTexts(mapped, partOf) + hugContent(mapped, partOf, comp, !!p.spec);
    p.sized += await ellipsize(comp, !!p.spec) + stretchOver(comp) + oneCell(comp);
    // (after the sizing pass, which reads fixed lengths from the occurrences) a picture alone in a
    // box that centers it is `object-fit: contain`: the capture sized the layer
    // to this occurrence's photo (41 px wide here, 83 there) and an instance can't resize a layer,
    // so it fills the box and the image fits inside it — every photo keeps its aspect
    for (const f of comp.findAll((n) => n.type === 'FRAME' && n.children.length === 1 && isPicture(n.children[0]))) {
      if (!f.layoutMode || f.layoutMode === 'NONE' || f.primaryAxisAlignItems !== 'CENTER' || f.counterAxisAlignItems !== 'CENTER') continue;
      const pic = f.children[0];
      try { pic.layoutSizingHorizontal = 'FILL'; pic.layoutSizingVertical = 'FILL'; pic.fills = pic.fills.map((x) => (x.type === 'IMAGE' ? { ...x, scaleMode: 'FIT' } : x)); } catch (e) {}
    }
    if (isPicture(comp.children[0] || {}) && comp.children.length === 1 && comp.layoutMode && comp.layoutMode !== 'NONE' && comp.primaryAxisAlignItems === 'CENTER' && comp.counterAxisAlignItems === 'CENTER') {
      const pic = comp.children[0];
      try { pic.layoutSizingHorizontal = 'FILL'; pic.layoutSizingVertical = 'FILL'; pic.fills = pic.fills.map((x) => (x.type === 'IMAGE' ? { ...x, scaleMode: 'FIT' } : x)); } catch (e) {}
    }
    let spec = p.spec ? JSON.parse(JSON.stringify(p.spec)) : null;
    if (spec && spec.cells) {
      // each changing cell keeps its frame (padding, alignment, track) and holds its content as a slot
      for (const i of spec.cells) {
        const S = comp.children[i];
        SET(S, 'cellKey', partKey(S));
        SET(S, 'slotFrame', '1');
      }
    } else if (spec) {
      const S = makeSlot(comp, spec, slotName);
      if (!S) spec = null;
      else {
        SET(S, 'slotFrame', '1');
        const plan = hugPlan(comp, spec, repHugsH);
        if (kind === 'list') {
          // the main shows a few rows: the rest live in each screen's instance
          const kids = S.children.filter((c) => c.visible);
          S.children.filter((c) => !c.visible).forEach((c) => c.remove());
          let seen = 0;
          for (const c of kids) { if (isItem(c, row) && ++seen > PARAMS.keep) c.remove(); }
        }
        hugUp(comp, plan);
      }
    }
    // before settle: a child that filled the height of a box that now hugs it must stop filling
    hugWraps(comp);
    p.settled = settle(comp);
    SET(comp, 'spec', spec ? JSON.stringify(spec) : '');
    // the size to keep once the variants share a set (combining re-flows them)
    p.hugsV = hugsAxis(comp, false); p.hugsH = hugsAxis(comp, true);
    p.size = [comp.width, comp.height];
    p.comp = comp; p.twin = twin; p.optional = optional.map((n) => twin.get(n)).filter(Boolean); p.flexed = flexed; p.spec2 = spec;
    created.push(comp);
  }
  let owner;
  if (created.length > 1 || hasProps || needTipo) {
    owner = figma.combineAsVariants(created, compPage);
    owner.name = ui;
    owner.layoutMode = 'HORIZONTAL'; owner.layoutWrap = 'WRAP';
    owner.itemSpacing = 40; owner.counterAxisSpacing = 40;
    owner.paddingLeft = owner.paddingRight = owner.paddingTop = owner.paddingBottom = 40;
    owner.primaryAxisSizingMode = 'AUTO'; owner.counterAxisSizingMode = 'AUTO';
    owner.x = PARAMS.origin[0]; owner.y = cursorY;
    for (const p of plan) {
      standAlone(p.comp, p.hugsV, p.hugsH);
      const [w, h] = p.size;
      try { p.comp.resize(p.hugsH ? p.comp.width : Math.max(w, 0.01), p.hugsV ? p.comp.height : Math.max(h, 0.01)); } catch (e) {}
      // resize fixes both axes: an axis that hugs goes back to hugging
      if (p.hugsV || p.hugsH) standAlone(p.comp, p.hugsV, p.hugsH);
    }
    // a wide set wraps instead of running for thousands of pixels
    if (owner.width > 2600) { owner.primaryAxisSizingMode = 'FIXED'; owner.resize(2600, owner.height); owner.counterAxisSizingMode = 'AUTO'; }
  } else { owner = created[0]; try { owner.layoutGrow = 0; } catch (e) {} }
  SET(owner, 'component', ui);
  SET(owner, 'kind', kind);
  const ref = PARAMS.codeRefs[ui];
  const words = PARAMS.text || { ref: 'From the prototype: {ref}', none: 'From the prototype.' };
  owner.description = ref ? words.ref.replace('{ref}', ref) : words.none;
  cursorY = owner.y + owner.height + 160;

  // SLOT property: every variant's slot frame
  const slotted2 = plan.filter((p) => p.spec2 && !p.spec2.cells);
  let slotKey = null;
  if (slotted2.length) {
    try {
      slotKey = owner.addComponentProperty(slotName, 'SLOT', '');
      for (const p of slotted2) { const S = nodeAt(p.comp, p.spec2.slotPath); S.componentPropertyReferences = { slotContentId: slotKey }; S.name = slotName; }
    } catch (e) { report._slotErrors = (report._slotErrors || []).concat(ui + ': ' + String(e).slice(0, 120)); }
  }
  // cell slots: "Cell 1", "Cell 2"… by column, shared by the variants that have that column
  const cellKeys = {};
  for (const p of plan.filter((q) => q.spec2 && q.spec2.cells)) {
    for (const i of p.spec2.cells) {
      try {
        const nm = 'Cell ' + (i + 1);
        if (!cellKeys[nm]) cellKeys[nm] = owner.addComponentProperty(nm, 'SLOT', '');
        p.comp.children[i].componentPropertyReferences = { slotContentId: cellKeys[nm] };
      } catch (e) { report._slotErrors = (report._slotErrors || []).concat(ui + ' cell ' + i + ': ' + String(e).slice(0, 100)); }
    }
  }
  // BOOLEAN properties: a part some screens don't show
  const boolKeys = {};
  let bools = 0;
  for (const p of plan) {
    const map = {}, seen = {};
    for (const n of p.optional) {
      // two optional parts with one name (a header's two tool buttons) each get their own switch:
      // one shared switch can't show one and hide the other
      const base = (n.type === 'INSTANCE' ? n.name : n.name.replace(/^slot\//, '')).slice(0, 36) || n.type.toLowerCase();
      seen[base] = (seen[base] || 0) + 1;
      const label = seen[base] > 1 ? `${base} ${seen[base]}` : base;
      try {
        if (!boolKeys[label]) boolKeys[label] = owner.addComponentProperty(label, 'BOOLEAN', true);
        n.componentPropertyReferences = Object.assign({}, n.componentPropertyReferences || {}, { visible: boolKeys[label] });
        map[n.id] = boolKeys[label]; bools++;
      } catch (e) {}
    }
    SET(p.comp, 'bools', JSON.stringify(map));
    // the grids that hold these parts stop reserving their room (flowOptional)
    const flowed = new Set();
    for (const n of p.optional) { const P = n.parent; if (P && !flowed.has(P.id) && flowOptional(P, n)) flowed.add(P.id); }
  }
  // TEXT properties: the adapter's text slots, bound inside their tagged layer. A slot element
  // that held only text came out of the capture as a bare text layer, without its tag: it is the
  // main's own text that shows one of the texts the slot showed on the page (slotText), the one at
  // the slot's place when several do. It gets the slot's tag, so verify-slots finds it too
  const slotsJson = list[0] && U(list[0], 'slots');
  const tagged = slotsJson ? JSON.parse(slotsJson) : {};
  const known = (PARAMS.slotText || {})[ui] || {};
  const textProps = [];
  {
    const flatT = (x) => x.replace(/\s+/g, ' ').trim();
    // the main's own layers only: a text inside a nested instance can't take this set's property
    const own = (root, pred) => { let hit = null; const walk = (n) => { if (hit) return; for (const c of n.children || []) { if (c.type === 'INSTANCE' || U(c, 'slotFrame')) continue; if (pred(c)) { hit = c; return; } walk(c); } }; walk(root); return hit; };
    const byText = (c, slot) => {
      const k = known[slot];
      if (!k || !k.values || !k.values.length) return null;
      const vals = new Set(k.values), hits = [];
      const walk = (n) => { for (const x of n.children || []) { if (x.type === 'INSTANCE' || U(x, 'slotFrame') || U(x, 'slot')) continue; if (x.type === 'TEXT' && vals.has(flatT(x.characters))) hits.push(x); walk(x); } };
      walk(c);
      if (hits.length === 1) return hits[0];
      let at = k.path ? nodeAt(c, k.path) : null;
      if (at && at.type !== 'TEXT' && 'children' in at && at.children.length === 1) at = at.children[0];
      return hits.includes(at) ? at : null;
    };
    for (const slot of [...new Set([...Object.keys(tagged), ...Object.keys(known)])]) {
      const value = tagged[slot] || (known[slot] && known[slot].values[0]) || '';
      if (!value) continue;
      const inSlot = (c) => {
        const box = own(c, (n) => U(n, 'slot') === slot);
        if (box) return box.type === 'TEXT' ? box : own(box, (t) => t.type === 'TEXT');
        const t = byText(c, slot);
        if (t) SET(t, 'slot', slot);
        return t;
      };
      const texts = created.map(inSlot).filter(Boolean);
      if (!texts.length) continue;
      try {
        const key = owner.addComponentProperty(slot, 'TEXT', (texts.find((t) => t.characters.replace(/\s+/g, ' ').trim() === value) || texts[0]).characters);
        // the box around a text the capture drew at its own lines (a label on two lines) keeps that
        // height once the property shows another value (one line, at the top of a 37 px box): a box
        // that was exactly its text's height hugs the text it shows now
        const boxes = texts.map((t) => { const f = t.parent; return f && f.type === 'FRAME' && f.children.length === 1 && (f.layoutMode === 'VERTICAL' || f.layoutMode === 'HORIZONTAL') && f.layoutSizingVertical === 'FIXED' && Math.abs(f.height - f.paddingTop - f.paddingBottom - t.height) <= 1 ? [f, t.height] : null; });
        for (const t of texts) { await loadFontsOf(t); t.componentPropertyReferences = Object.assign({}, t.componentPropertyReferences || {}, { characters: key }); }
        for (const b of boxes) if (b && Math.abs(b[0].children[0].height - b[1]) > 1) { try { b[0].layoutSizingVertical = 'HUG'; } catch (e) {} }
        textProps.push(slot);
      } catch (e) {}
    }
  }
  report[ui] = { kind, occurrences: list.length, variants: plan.length, slot: slotted2.length ? slotName : Object.keys(cellKeys).length ? Object.keys(cellKeys).length + ' cells' : null,
    booleans: Object.keys(boolKeys).length, textProps, flexGrids: plan.reduce((s, p) => s + p.flexed, 0), id: owner.id };
}
report._gridWarnings = gridWarnings;
report._ms = Date.now() - T0;
report._textWarnings = textWarnings;
report._growMisses = growMisses;
return report;
