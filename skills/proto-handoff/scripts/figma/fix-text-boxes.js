// use_figma script template — gives right-aligned and centered texts the box they had in the
// browser. The capture makes a text layer as wide as its glyphs and puts it at the left of the
// element's box, so a count pushed to the right end of a header ("58 rows") lands ~100 px to the
// left, and a centered label drifts. From the DOM map (capture-batch: ta, tx, pad): each such
// element's content box and its text; the text layer at that spot with that text takes the box
// width and keeps its alignment. Runs after 02-tags and before the components (the corrected
// boxes go into the mains). Safe to re-run.
const PARAMS = /*PARAMS*/ { frames: {} } /*END*/;
// frames: { "<frame id>": [[x, y, w, 'r'|'c', text], …] }  content box relative to the frame

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const out = { fixed: 0, already: 0, unmatched: 0 };
for (const [fid, boxes] of Object.entries(PARAMS.frames)) {
  const frame = await figma.getNodeByIdAsync(fid);
  if (!frame || !boxes.length) continue;
  const fb = frame.absoluteBoundingBox;
  const texts = [];
  const walk = (n) => { for (const c of n.children || []) { if (c.type === 'INSTANCE') continue; if (c.type === 'TEXT') { const b = c.absoluteBoundingBox; if (b) texts.push({ t: c, x: b.x - fb.x, y: b.y - fb.y }); } else walk(c); } };
  walk(frame);
  for (const [x, y, w, ta, tx] of boxes) {
    const want = norm(tx).slice(0, 14);
    const hit = texts.filter((k) => k.x > x - 2.5 && k.x < x + w && Math.abs(k.y - y) < 5 && norm(k.t.characters).startsWith(want))
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
    if (!hit) { out.unmatched++; continue; }
    const t = hit.t;
    // glyphs as wide as the box have nothing to align: a fixed box there wraps a longer text in
    // the instances (a tab's one-digit count box split "22" over two lines)
    if (Math.abs(t.width - w) <= 1 && t.textAutoResize === 'WIDTH_AND_HEIGHT') { out.already++; continue; }
    if (t.width >= w - 1 && t.textAutoResize !== 'WIDTH_AND_HEIGHT') { out.already++; continue; }
    for (const s of t.getStyledTextSegments(['fontName'])) await figma.loadFontAsync(s.fontName);
    const auto = t.parent && t.parent.layoutMode && t.parent.layoutMode !== 'NONE';
    t.textAutoResize = 'HEIGHT';
    t.textAlignHorizontal = ta === 'c' ? 'CENTER' : 'RIGHT';
    t.resize(Math.max(w, 1), t.height);
    if (!auto) t.x += x - hit.x;
    out.fixed++;
  }
}
return out;
