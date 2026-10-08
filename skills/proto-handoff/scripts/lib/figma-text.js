// Plugin-API snippet (plain JS) inlined where a template says TEXT: carrying one layer's
// content onto another — its text with every styled run, its paints, its instance swap — and
// the same, recursively, for layers with the same structure. The level builder's version of
// figma-shape.js without the old shape keys and list growing.
let textWarnings = 0, gridWarnings = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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
  // gives would detach the text from its style
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
// src's content onto dst, the same structure below (nested instances included: their text,
// fills and layout are per-occurrence overrides too; copyLayout lives in the kit)
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
async function copyOverrides(src, dst, icon) {
  let n = 0;
  if (src.type === 'TEXT' && dst.type === 'TEXT') n += await copyText(src, dst);
  if (src.type === 'INSTANCE' && dst.type === 'INSTANCE') {
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
  for (const k of ['visible', 'opacity']) if (k in src && src[k] !== dst[k]) { try { dst[k] = src[k]; n++; } catch (e) {} }
  n += copyLayout(src, dst);
  if ('children' in src && 'children' in dst && src.children.length === dst.children.length) {
    for (let i = 0; i < src.children.length; i++) n += await copyOverrides(src.children[i], dst.children[i], icon);
  } else if ('children' in src && 'children' in dst && src.children.length < dst.children.length) {
    // the occurrence lacks parts the main has (a chat header without its "new chat" button): pair
    // the parts by tag or name in order and hide the main's leftovers, only when every part paired
    const tag = (c) => c.getSharedPluginData('uic', 'ui') || c.name;
    const used = new Set();
    let j = 0;
    for (const s of src.children) {
      while (j < dst.children.length && tag(dst.children[j]) !== tag(s)) j++;
      if (j >= dst.children.length) break;
      used.add(j); j++;
    }
    if (used.size === src.children.length) {
      const pairs = [...used];
      for (let k = 0; k < src.children.length; k++) n += await copyOverrides(src.children[k], dst.children[pairs[k]], icon);
      for (let k = 0; k < dst.children.length; k++) if (!used.has(k) && dst.children[k].visible) { try { dst.children[k].visible = false; n++; } catch (e) {} }
    }
  }
  return n;
}
