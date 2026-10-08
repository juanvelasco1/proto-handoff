// Plugin-API snippet (plain JS, inlined into build-components.js and swap-existing.js where the
// template says SHAPE). What makes two occurrences "the same component", and how an occurrence's
// content is carried onto a new instance.
//
// shapeKey — structure plus, for layers without auto layout, where the children sit. A text
// counts by its anchor (left, center or right edge, by its alignment), never by its width:
// "Blue notebook" and "Pen" in the same cell are one shape, not two variants.
//
// Lists — an adapter entry with "list": "<RowComponent>" (a table and its rows) is one
// component whatever its row count and width: the shape is the structure with the rows
// collapsed to the first, the main is the longest occurrence (growList adds rows when a longer
// one shows up), and an instance hides the rows its occurrence doesn't have.
// Editing the table's main (or the row's) then edits every table in every design.
const LISTS = (typeof PARAMS !== 'undefined' && PARAMS.lists) || {};
let textWarnings = 0, gridWarnings = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isRowOf = (c, row) => !!row && (c.getSharedPluginData('uic', 'ui') === row || (c.type === 'INSTANCE' && c.name === row));
const hasRows = (x, row) => !!row && 'children' in x && x.children.some((c) => isRowOf(c, row));
function rowsBox(n, row) {
  if (!row || !('children' in n)) return null;
  if (hasRows(n, row)) return n;
  for (const c of n.children) { if (c.type === 'INSTANCE') continue; const r = rowsBox(c, row); if (r) return r; }
  return null;
}
const rowCount = (n, row) => { const b = rowsBox(n, row); return b ? b.children.filter((c) => isRowOf(c, row)).length : 0; };
// children with the rows of a list collapsed to the first one
const kidsOf = (x, row) => {
  if (!hasRows(x, row)) return x.children;
  let seen = false;
  return x.children.filter((c) => { if (!isRowOf(c, row)) return true; if (seen) return false; seen = true; return true; });
};
const sig = (n, row) => {
  if (n.type === 'INSTANCE') return 'I';
  if (!('children' in n) || !n.children.length) return n.type[0];
  return n.type[0] + '[' + kidsOf(n, row).map((c) => sig(c, row)).join(',') + ']';
};
const r2 = (v) => Math.round(v / 2);
function shapeKey(n, row) {
  // a list is its structure: the same table is wider on one screen than another (an instance
  // takes its width) and longer or shorter (an instance hides the rows it doesn't have)
  if (row) return sig(n, row).replace(/^C/, 'F') + '#list';
  const geo = [];
  const walk = (x) => {
    if (x.type === 'INSTANCE' || !('children' in x)) return;
    const fixed = !('layoutMode' in x) || x.layoutMode === 'NONE' || x.layoutMode === 'GRID';
    for (const c of kidsOf(x, row)) {
      if (fixed) {
        if (c.type === 'TEXT') {
          const a = c.textAlignHorizontal;
          geo.push('t' + [a === 'RIGHT' ? c.x + c.width : a === 'CENTER' ? c.x + c.width / 2 : c.x, c.y].map(r2).join(','));
        } else if (hasRows(c, row)) geo.push('L' + [c.x, c.y, c.width].map(r2).join(','));   // a list grows: no height
        else geo.push([c.x, c.y, c.width, c.height].map(r2).join(','));
      }
      walk(c);
    }
  };
  walk(n);
  return sig(n, row).replace(/^C/, 'F') + '#' + geo.join(';');
}

// a longer occurrence grows the list's main instead of making a new variant: the rows it adds
// are hidden in every instance that already existed, so no design changes
async function growList(main, want, row) {
  const box = rowsBox(main, row);
  if (!box) return false;
  const rows = box.children.filter((c) => isRowOf(c, row));
  const have = rows.length;
  if (want <= have) return true;
  const before = await main.getInstancesAsync();
  const last = rows[have - 1];
  let at = box.children.indexOf(last);
  for (let i = have; i < want; i++) box.insertChild(++at, last.clone());
  if (box.layoutMode === 'VERTICAL') box.primaryAxisSizingMode = 'AUTO';
  if (main !== box && main.layoutMode === 'VERTICAL') main.primaryAxisSizingMode = 'AUTO';
  for (const inst of before) {
    const b = rowsBox(inst, row);
    if (b) b.children.filter((c) => isRowOf(c, row)).slice(have).forEach((c) => { c.visible = false; });
  }
  return true;
}

async function loadFontsOf(t) {
  if (t.characters.length === 0) { if (t.fontName !== figma.mixed) await figma.loadFontAsync(t.fontName); return; }
  for (const s of t.getStyledTextSegments(['fontName'])) await figma.loadFontAsync(s.fontName);
}
const SEG = ['fontName', 'fontSize', 'fills', 'textDecoration', 'letterSpacing', 'lineHeight', 'textCase', 'textStyleId'];
// one property at a time: Figma rejects some captured values (variable-font axes it does not
// expose), and one rejected property must not cost the rest of the styling
const SETTERS = [['fontName', 'setRangeFontName', 'getRangeFontName'], ['fontSize', 'setRangeFontSize', 'getRangeFontSize'],
  ['fills', 'setRangeFills', 'getRangeFills'], ['textDecoration', 'setRangeTextDecoration', 'getRangeTextDecoration'],
  ['letterSpacing', 'setRangeLetterSpacing', 'getRangeLetterSpacing'], ['lineHeight', 'setRangeLineHeight', 'getRangeLineHeight'],
  ['textCase', 'setRangeTextCase', 'getRangeTextCase']];
async function copyText(src, dst) {
  const segs = src.getStyledTextSegments(SEG);
  if (src.characters === dst.characters && eq(segs, dst.getStyledTextSegments(SEG))) return 0;
  await loadFontsOf(src); await loadFontsOf(dst);
  if (src.characters !== dst.characters) dst.characters = src.characters;
  // the text style first, then only what still differs: setting a property the style already
  // gives would detach the text from its style (and undo the tokens on every instance)
  for (const s of segs) {
    if (s.end <= s.start) continue;
    if (s.textStyleId && dst.getRangeTextStyleId(s.start, s.end) !== s.textStyleId) {
      try { await dst.setRangeTextStyleIdAsync(s.start, s.end, s.textStyleId); } catch (e) { textWarnings++; }
    }
    for (const [k, set, get] of SETTERS) {
      let cur; try { cur = dst[get](s.start, s.end); } catch (e) { cur = figma.mixed; }
      if (cur !== figma.mixed && eq(cur, s[k])) continue;
      try { dst[set](s.start, s.end, s[k]); } catch (e) { textWarnings++; }
    }
  }
  return 1;
}
// keepMain: dst stays an instance of its own main (merging variants); nested instances still
// take their source's main, which is what makes them per-occurrence overrides
// a nested instance swapped to another main keeps the length its old one had there (an instance's
// layers take no size: resize() leaves them as they were): it hugs its new content when that lands
// on the source's length, else the swap reports it (a mark that took a bar's 2 536 px)
const swapMisses = [];
function fitSwapped(src, dst) {
  for (const h of [true, false]) {
    const key = h ? 'layoutSizingHorizontal' : 'layoutSizingVertical', len = h ? src.width : src.height, now = () => (h ? dst.width : dst.height);
    if (Math.abs(len - now()) <= 2) continue;
    try { dst.resize(h ? len : dst.width, h ? dst.height : len); } catch (e) {}
    if (Math.abs(len - now()) <= 2) continue;
    // hug its content or run its parent's length, whichever lands on the source's (a label that
    // filled its row: hugging, it took its old main's 54 px in a 46 px row); neither: the closest,
    // a fixed length settling first on the mode that came nearest to it
    const was = dst[key], len0 = now(), got = [[was, len0]];
    for (const mode of ['HUG', 'FILL']) {
      if (mode === was) continue;
      try { dst[key] = mode; } catch (e) { continue; }
      got.push([mode, now()]);
      if (Math.abs(len - now()) <= 2) break;
    }
    if (Math.abs(len - now()) <= 2) continue;
    got.sort((x, y) => Math.abs(x[1] - len) - Math.abs(y[1] - len));
    try {
      if (got[0][0] === 'FIXED') { const near = got.filter((x) => x[0] !== 'FIXED').sort((x, y) => Math.abs(x[1] - len0) - Math.abs(y[1] - len0))[0]; if (near) dst[key] = near[0]; }
      dst[key] = got[0][0];
    } catch (e) {}
    if (Math.abs(len - now()) > 2) swapMisses.push([src.name.slice(0, 40), h ? 'w' : 'h', +len.toFixed(1), +now().toFixed(1)]);
  }
}
async function copyOverrides(src, dst, row, keepMain, icon) {
  let n = 0;
  if (src.type === 'TEXT' && dst.type === 'TEXT') n += await copyText(src, dst);
  if (!keepMain && src.type === 'INSTANCE' && dst.type === 'INSTANCE') {
    const a = await src.getMainComponentAsync(), b = await dst.getMainComponentAsync();
    if (a && b && a.id !== b.id) { dst.swapComponent(a); fitSwapped(src, dst); n++; }
  }
  // inside an icon only its shapes take the color: the svg's box carries currentColor too, and on
  // the wrapper frame it paints a solid square behind the glyph (a chevron read as a black block)
  if (!icon && dst.type === 'INSTANCE') { const m = await dst.getMainComponentAsync(); icon = !!(m && /^Icon\//.test(m.name)); }
  const box = icon && (dst.type === 'FRAME' || dst.type === 'GROUP' || dst.type === 'INSTANCE');
  for (const k of ['fills', 'strokes', 'effects']) {
    if (box && k === 'fills') continue;
    if (k in src && k in dst && src[k] !== figma.mixed && !eq(src[k], dst[k])) { try { dst[k] = src[k]; n++; } catch (e) {} }
  }
  // prototype links are wired last (wire-links.js); a link copied here would leak into mains
  for (const k of ['visible', 'opacity']) if (k in src && src[k] !== dst[k]) { dst[k] = src[k]; n++; }
  if (!('children' in src) || !('children' in dst)) return n;
  if (hasRows(src, row) && hasRows(dst, row)) {
    // a list: what comes before the rows, the rows by index (extra rows hidden), what comes after
    const split = (l) => { const f = l.findIndex((c) => isRowOf(c, row)); let e = l.length - 1; while (!isRowOf(l[e], row)) e--; return [l.slice(0, f), l.slice(f, e + 1), l.slice(e + 1)]; };
    const [sp, sr, ss] = split(src.children), [dp, dr, ds] = split(dst.children);
    for (let i = 0; i < Math.min(sp.length, dp.length); i++) n += await copyOverrides(sp[i], dp[i], row, false, icon);
    for (let i = 0; i < dr.length; i++) {
      if (i < sr.length) { n += await copyOverrides(sr[i], dr[i], row, false, icon); if (!dr[i].visible) dr[i].visible = true; }
      else if (dr[i].visible) { dr[i].visible = false; n++; }
    }
    for (let i = 0; i < Math.min(ss.length, ds.length); i++) n += await copyOverrides(ss[i], ds[i], row, false, icon);
  } else if (src.children.length === dst.children.length) {
    // nested instances included: their text and fills are per-occurrence overrides too
    for (let i = 0; i < src.children.length; i++) n += await copyOverrides(src.children[i], dst.children[i], row, false, icon);
  }
  return n;
}
