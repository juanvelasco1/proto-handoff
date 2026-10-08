// Plugin-API snippet (plain JS, inlined into generated use_figma scripts).
// Matches DOM elements to captured Figma layers. The capture keeps every box's SIZE, but
// Figma re-flows auto layout, so positions can drift by a few pixels (scrollbar gutters,
// margins turned into wrapper frames). So: index layers by size, and look for each DOM
// element near where it should be once its matched ancestor's drift is applied.
// Entries come in DOM order with their depth, outer first.
function buildIndex(root) {
  const rx = root.absoluteTransform[0][2], ry = root.absoluteTransform[1][2];
  const bySize = new Map();
  const depthOf = new Map();
  const walk = (n, d) => {
    if (!('children' in n)) return;
    for (const c of n.children) {
      depthOf.set(c.id, d);
      const b = c.absoluteBoundingBox;
      if (b && c.type !== 'TEXT') {
        const k = Math.round(b.width) + ',' + Math.round(b.height);
        if (!bySize.has(k)) bySize.set(k, []);
        bySize.get(k).push({ n: c, x: b.x - rx, y: b.y - ry, d });
      }
      walk(c, d + 1);
    }
  };
  walk(root, 0);
  return { bySize, depthOf };
}
function matchAll(root, entries) {
  // entries: [{ r:[x,y,w,h], d:depth }]. Returns Map(entryIndex -> node).
  const { bySize } = buildIndex(root);
  const used = new Set();
  const hit = new Map();
  const drift = [];           // drift[depth] = [dx, dy] of the nearest matched ancestor
  entries.forEach((e, i) => {
    const d = e.d || 0;
    drift.length = d + 1;
    let base = [0, 0];
    for (let k = d - 1; k >= 0; k--) if (drift[k]) { base = drift[k]; break; }
    const [x, y, w, h] = e.r;
    const ex = x + base[0], ey = y + base[1];
    let best = null, bestDist = Infinity;
    for (const dw of [0, -1, 1]) for (const dh of [0, -1, 1]) {
      const list = bySize.get(Math.round(w + dw) + ',' + Math.round(h + dh));
      if (!list) continue;
      for (const c of list) {
        if (used.has(c.n.id)) continue;
        const dist = Math.abs(c.x - ex) + Math.abs(c.y - ey);
        // prefer the outermost layer when two share the same box
        const score = dist + c.d * 0.001;
        if (dist <= 24 && score < bestDist) { best = c; bestDist = score; }
      }
    }
    if (best) {
      used.add(best.n.id);
      hit.set(i, best.n);
      drift[d] = [best.x - x, best.y - y];
    }
  });
  return hit;
}
