// What a DOM map's nodes mean to the Figma side. The capture (html-to-design) does not make a
// layer for every element the browser drew:
//   merged  an element with the same box as its parent and no sibling is folded into the parent
//           (a record header inside a card header): one layer, the parent's name
//   blank   a box that paints nothing and holds nothing (a pane handle) may or may not come
//   fixed   a fixed-position box that paints nothing (a click-catcher veil) never comes
// "May" is the rule, not the exception: a record header folded into its card header, but an
// inbox panel as big as its column kept its layer, and a one-row bar chart kept its row. So the
// census requires the plain ones and allows every other tagged box; the lists paired by order
// (geometry, slot texts) carry the merged boxes flagged optional, and the Figma side counts them
// only when its instances say they came (a skipped merged row shifted every later row by one).
export function annotate(m) {
  const stack = [];
  for (const n of m.nodes) {
    while (stack.length && stack[stack.length - 1].d >= n.d) stack.pop();
    const p = stack.length ? stack[stack.length - 1] : null;
    if (p) {
      p.kids = (p.kids || 0) + 1;
      if (p.kids === 1 && n.r.every((v, i) => Math.abs(v - p.r[i]) <= 0.5)) n.merged = true;
      else if (p.kids > 1 && p.mergedChild) { p.mergedChild.merged = false; }
      if (n.merged) p.mergedChild = n;
    }
    stack.push(n);
  }
  for (const n of m.nodes) { delete n.kids; delete n.mergedChild; }
  return m;
}
// the map's component boxes, in document order, for the lists paired by order
export const onScreen = (n) => !!n.ui && !n.merged && !(n.fixed && n.blank);
// what the census requires (plain) and allows on top (blank)
export const required = (n) => onScreen(n) && !n.blank;
// the census of one screen: what it must show (plain) and what it may show on top (slack)
export function censusOf(m) {
  const census = {}, slack = {};
  for (const n of annotate(m).nodes) {
    if (!n.ui) continue;
    if (required(n)) census[n.ui] = (census[n.ui] || 0) + 1; else slack[n.ui] = (slack[n.ui] || 0) + 1;
  }
  return { census, slack };
}
// every component box in document order, for the geometry audit: [x, y, w, h, g, optional], to
// 0.1 px (whole pixels added up to a px of error against a ±2 px tolerance)
// g: the scrollbar room of the box that scrolls around it (the layer may be that much wider in
// Figma); optional: a merged box (see above)
export function geoOf(m) {
  const dom = {}, stack = [];
  for (const n of annotate(m).nodes) {
    while (stack.length && stack[stack.length - 1].d >= n.d) stack.pop();
    const g = [...stack].reverse().find((s) => s.sb);
    if (n.ui && (onScreen(n) || n.merged)) (dom[n.ui] = dom[n.ui] || []).push(n.r.map((v) => Math.round(v * 10) / 10).concat([g ? g.sb : 0, onScreen(n) ? 0 : 1]));
    stack.push({ d: n.d, sb: /y/.test(n.scroll || '') ? n.sb || 0 : 0 });
  }
  return dom;
}
// every occurrence of a slotted component, with or without texts (order pairing needs the whole
// list): [ui, x, y, { slot: text }, optional]
export function slotsOf(m, slotUis) {
  return annotate(m).nodes.filter((x) => slotUis.has(x.ui) && (onScreen(x) || x.merged))
    .map((x) => [x.ui, Math.round(x.r[0]), Math.round(x.r[1]), x.slots || {}, onScreen(x) ? 0 : 1]);
}

// CSS width floors of slot texts: a slot whose box keeps the same width in several occurrences
// that hold different texts has a min-width (or width) of its own — `.section-meta { min-width: 20ch }`
// in a wrapping header: the browser moves the meta to its own line when less than 20ch is left,
// while Figma, with no floor, shrinks it to the leftover room and keeps one line. The narrowest
// width is the floor when at least two occurrences with different texts sit on it.
//   → { ui: { slot: { px, path } } } for build-level's minW; path: the slot's child indices under
//     the component in the page (a text slot carries no tag in the main: the path finds it)
export function minWidthsOf(maps, adapter) {
  const slotsOfUi = Object.fromEntries((adapter.components || []).filter((c) => c.slots).map((c) => [c.ui, c.slots]));
  const cls = (sel) => sel.replace(/^[\s.>]+/, '').split(/[\s.>:[]/)[0];
  const acc = {};
  for (const m of maps) {
    const N = m.nodes;
    for (let i = 0; i < N.length; i++) {
      const n = N[i], slots = n.ui && slotsOfUi[n.ui];
      if (!slots) continue;
      for (let j = i + 1; j < N.length && N[j].d > n.d; j++) {
        const c = N[j];
        if (c.tx === undefined) continue;
        for (const [slot, sel] of Object.entries(slots)) if (c.name === cls(sel)) ((acc[n.ui] = acc[n.ui] || {})[slot] = acc[n.ui][slot] || []).push([c.r[2], c.tx, pathTo(N, i, j)]);
      }
    }
  }
  const out = {};
  for (const [ui, bySlot] of Object.entries(acc)) for (const [slot, v] of Object.entries(bySlot)) {
    const min = Math.min(...v.map((x) => x[0]));
    const at = v.filter((x) => Math.abs(x[0] - min) < 0.6);
    if (!(min > 0 && at.length >= 2 && new Set(at.map((x) => x[1])).size >= 2)) continue;
    const paths = {};
    for (const x of v) paths[x[2]] = (paths[x[2]] || 0) + 1;
    const path = Object.entries(paths).sort((a, b) => b[1] - a[1])[0][0].split('.').filter(Boolean).map(Number);
    (out[ui] = out[ui] || {})[slot] = { px: Math.round(min * 10) / 10, path };
  }
  return out;
}
// child indices from node i down to its descendant j in a flat depth-first node list
function pathTo(N, i, j) {
  const chain = [];
  for (let k = j; k > i; ) {
    let p = k - 1;
    while (p > i && N[p].d >= N[k].d) p--;
    let idx = 0;
    for (let q = p + 1; q < k; q++) if (N[q].d === N[k].d) idx++;
    chain.unshift(idx);
    k = p;
  }
  return chain.join('.');
}
