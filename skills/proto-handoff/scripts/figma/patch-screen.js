// use_figma script template — applies box changes that paint nothing new (a text box that got
// wider, a label that moved inside its row) to the existing layers, without recapturing.
// OPS come from sync.mjs: every changed box plus its ancestors (the matcher needs them).
/*MATCHER*/
const PARAMS = /*PARAMS*/ { frame: '', ops: [] } /*END*/;   // ops: [{ r, d, to|null, name }]

const root = await figma.getNodeByIdAsync(PARAMS.frame);
const hit = matchAll(root, PARAMS.ops.map((o) => ({ r: o.r, d: o.d })));
const rx = root.absoluteTransform[0][2], ry = root.absoluteTransform[1][2];
// the matcher skips text layers (annotation names containers); a changed box is often a text
// span, so look for it among the text layers of its nearest matched ancestor
PARAMS.ops.forEach((o, i) => {
  if (hit.has(i) || !o.to) return;
  let anc = null, ai = -1;
  for (let j = i - 1; j >= 0; j--) if (PARAMS.ops[j].d < o.d && hit.has(j)) { anc = hit.get(j); ai = j; break; }
  if (!anc) return;
  const ab = anc.absoluteBoundingBox;
  const dx = ab.x - rx - PARAMS.ops[ai].r[0], dy = ab.y - ry - PARAMS.ops[ai].r[1];
  let best = null, bestD = 25;
  for (const t of anc.findAllWithCriteria({ types: ['TEXT'] })) {
    const b = t.absoluteBoundingBox;
    if (Math.abs(b.width - o.r[2]) > 2 || Math.abs(b.height - o.r[3]) > 2) continue;
    const d = Math.abs(b.x - rx - (o.r[0] + dx)) + Math.abs(b.y - ry - (o.r[1] + dy));
    if (d < bestD) { best = t; bestD = d; }
  }
  if (best) hit.set(i, best);
});
let resized = 0, moved = 0;
const fonts = new Set();
for (const t of root.findAllWithCriteria({ types: ['TEXT'] })) {
  if (t.characters.length) for (const s of t.getStyledTextSegments(['fontName'])) fonts.add(JSON.stringify(s.fontName));
}
for (const f of fonts) { try { await figma.loadFontAsync(JSON.parse(f)); } catch (e) {} }
// all or nothing: a patch that cannot find every changed layer would leave the screen half
// old, half new. Throwing rolls the call back; sync.mjs then escalates the screen to recapture.
const lost = PARAMS.ops.filter((o, i) => o.to && !hit.has(i)).map((o) => o.name);
if (lost.length) throw new Error('PATCH_UNMATCHED ' + PARAMS.frame + ': ' + lost.join(', '));
PARAMS.ops.forEach((o, i) => {
  if (!o.to) return;
  const n = hit.get(i);
  const [x, y, w, h] = o.to;
  // the drift the matcher measured on this layer applies to its new box too
  const b = n.absoluteBoundingBox;
  const dx = b.x - rx - o.r[0], dy = b.y - ry - o.r[1];
  if (Math.abs(n.width - w) > 0.5 || Math.abs(n.height - h) > 0.5) {
    try { n.resize(Math.max(w, 0.01), Math.max(h, 0.01)); resized++; } catch (e) {}
  }
  const p = n.parent;
  const free = !('layoutMode' in p) || p.layoutMode === 'NONE' || n.layoutPositioning === 'ABSOLUTE';
  if (free && (Math.abs(b.x - rx - (x + dx)) > 0.5 || Math.abs(b.y - ry - (y + dy)) > 0.5)) {
    n.x += (x + dx) - (b.x - rx); n.y += (y + dy) - (b.y - ry); moved++;
  }
});
return { frame: PARAMS.frame, changed: PARAMS.ops.filter((o) => o.to).length, resized, moved };
