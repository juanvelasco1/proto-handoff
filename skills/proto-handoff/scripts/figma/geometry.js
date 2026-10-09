// use_figma script template — READ-ONLY geometry audit. Pairs every tagged component occurrence
// the browser drew (DOM map, document order) with the instance in the frame (tree order, same
// component) and measures how far the box moved or changed size. Order, not position, pairs
// them: a list that shifted one row still pairs row k with row k.
//   PARAMS.frames: { "<frame id>": { "<ui>": [[x, y, w, h, g?, optional?], …] } }   (DOM boxes relative to the frame)
// optional: a box the browser folded into its parent (same box, only child); the capture may or
// may not have given it a layer, so it is paired only when the instance count says it came
// g: the scrollbar of the box that scrolls around it took g px in the browser and takes none in
// Figma, so there the layer may be up to g wider (it filled) or up to g further right (centered,
// right-aligned) and still be right
// Returns per frame the share of boxes within tolerance and, per component, how many are off
// and by how much (median of the signed deltas), so a systematic defect shows as one line.
// drift: Figma sets each text line on whole pixels (a line of 18.125 px is 19 tall), so the capture
// draws a page a little longer than the browser, and the rounding adds up down the page. read-tags
// keeps the capture's own boxes (uic capGeo on the frame, before anything moved); a box that sits
// where the capture drew it (within tol), where the capture itself was within DRIFT of the browser,
// is counted apart as drift: pct is strict against the browser, pctAdj adds the drift. A box the
// capture drew further off than DRIFT (a margin baked in, a gutter) must match the browser
const PARAMS = /*PARAMS*/ { frames: {}, tol: 2 } /*END*/;

const U = (n, k) => n.getSharedPluginData('uic', k);
const TOL = PARAMS.tol || 2;
const DRIFT = PARAMS.drift || [3, 6];   // [x and width, y and height]
const med = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return Math.round(s[s.length >> 1] * 10) / 10; };
const out = [];
for (const [fid, dom] of Object.entries(PARAMS.frames)) {
  const f = await figma.getNodeByIdAsync(fid);
  if (!f) { out.push({ fid, missing: true }); continue; }
  const fb = f.absoluteBoundingBox;
  const figs = {};
  const walk = (n, hidden) => {
    const h = hidden || n.visible === false;
    const ui = U(n, 'ui');
    if (ui && !h && n.type === 'INSTANCE' && n.absoluteBoundingBox) {
      const b = n.absoluteBoundingBox;
      (figs[ui] = figs[ui] || []).push([b.x - fb.x, b.y - fb.y, b.width, b.height]);
    }
    if ('children' in n) for (const c of n.children) walk(c, h);
  };
  for (const c of f.children) walk(c, false);
  let cap = {};
  try { cap = JSON.parse(U(f, 'capGeo') || '{}'); } catch (e) {}
  let pairs = 0, good = 0, drift = 0;
  const bad = {};
  for (const [ui, all] of Object.entries(dom)) {
    const got = figs[ui] || [], drawn = cap[ui] || [];
    const plain = all.filter((b) => !b[5]);
    const boxes = got.length === all.length || Math.abs(got.length - all.length) < Math.abs(got.length - plain.length) ? all : plain;
    const k = Math.min(boxes.length, got.length);
    const d = { dx: [], dy: [], dw: [], dh: [] };
    let off = 0;
    for (let i = 0; i < k; i++) {
      const [x, y, w, h, g] = boxes[i], [X, Y, W, H] = got[i];
      pairs++;
      const e = [X - x, Y - y, W - w, H - h];
      const G = g || 0;
      const inside = (v, hi) => v >= -TOL && v <= hi + TOL;
      if (inside(e[0], G) && inside(e[2], G) && Math.abs(e[1]) <= TOL && Math.abs(e[3]) <= TOL) { good++; continue; }
      // the capture's box for the same instance: the nearest one it drew for this component (the
      // tree order can differ: a sticky header sits last in the capture and first once rehomed);
      // one drawn a row away fails the DRIFT test against the browser anyway
      let C = null;
      if (drawn.length === got.length) {
        let best = Infinity;
        for (const c of drawn) { const m = Math.max(...c.map((v, j) => Math.abs(v - got[i][j]))); if (m < best) { best = m; C = c; } }
      }
      if (C) {
        const c = [C[0] - x, C[1] - y, C[2] - w, C[3] - h], b = [X - C[0], Y - C[1], W - C[2], H - C[3]];
        const near = (v) => v >= -DRIFT[0] && v <= G + DRIFT[0];
        if (near(c[0]) && near(c[2]) && Math.abs(c[1]) <= DRIFT[1] && Math.abs(c[3]) <= DRIFT[1] && b.every((v) => Math.abs(v) <= TOL)) { drift++; continue; }
      }
      // the same rounding inside the instances: a box under a column of texts that hug their
      // lines sits lower than the browser drew it, never higher, and never further sideways (a
      // chat panel's rows 2 px down under its two-line header, where the capture kept the
      // browser's heights). Downward only, within DRIFT, its width kept: that is drift too
      if (inside(e[0], G) && inside(e[2], G) && e[1] > TOL && e[1] <= DRIFT[1] && e[3] >= -TOL && e[3] <= DRIFT[1]) { drift++; continue; }
      off++;
      d.dx.push(e[0]); d.dy.push(e[1]); d.dw.push(e[2]); d.dh.push(e[3]);
    }
    if (off || boxes.length !== got.length) {
      bad[ui] = { n: boxes.length, m: got.length, off, dx: med(d.dx), dy: med(d.dy), dw: med(d.dw), dh: med(d.dh) };
    }
  }
  const pct = (v) => pairs ? Math.round(v / pairs * 1000) / 10 : 100;
  out.push({ fid, name: f.name.slice(0, 40), pairs, good, drift, pct: pct(good), pctAdj: pct(good + drift), captured: Object.keys(cap).length > 0, bad });
  await new Promise((r) => setTimeout(r, 0));
}
return { scope: 'geometry', frames: out };
