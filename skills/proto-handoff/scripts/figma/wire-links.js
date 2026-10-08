// use_figma script template — wires the clickable prototype from the prototype's own link table
// (capture-batch links.json), AFTER the component swap. Runs last on purpose:
//  - a component main is made from one occurrence, so link data on that occurrence would leak
//    into every instance (every rail row ending up on the same screen);
//  - the swap replaces layers, so reactions set earlier do not survive reliably.
// Each link carries the clicked element's box in its source screen; the layer that matches
// that box is the hotspot. Every other reaction on the screen is cleared, so re-running is safe.
const PARAMS = /*PARAMS*/ { page: '', componentsPage: '', frames: {}, links: [], flows: [], only: null } /*END*/;
// frames: { "<screen id>": "<frame id>" }
// links:  [{ from, to, r: [x, y, w, h], gesture?: 'scroll', via? }]  (from links.json)
// flows:  [{ name, start: "<frame id>" }]

const page = await figma.getNodeByIdAsync(PARAMS.page);
await figma.setCurrentPageAsync(page);
const out = { wired: [], unmatched: [], cleared: 0, flows: 0 };

// leaked link data on component mains and their layers
const leaked = (n) => n.getSharedPluginData('uic', 'link') !== '';
// a SLOT has reactions to read but none to set: it never takes a hotspot (its instance or a
// child does)
// a SLOT node throws on the mere lookup of setReactionsAsync
const canReact = (n) => { if (n.type === 'SLOT') return false; try { return typeof n.setReactionsAsync === 'function' && Array.isArray(n.reactions); } catch (e) { return false; } };
// only: the frames this batch owns (all of them when absent)
for (const f of PARAMS.only || Object.values(PARAMS.frames)) {
  const frame = await figma.getNodeByIdAsync(f);
  if (!frame) continue;
  for (const n of frame.findAll((x) => canReact(x) && x.reactions.length)) { await n.setReactionsAsync([]); out.cleared++; }
  for (const n of frame.findAll(leaked)) n.setSharedPluginData('uic', 'link', '');
}

const byFrom = {};
for (const l of PARAMS.links) (byFrom[l.from] = byFrom[l.from] || []).push(l);
for (const [screen, links] of Object.entries(byFrom)) {
  const frame = await figma.getNodeByIdAsync(PARAMS.frames[screen]);
  if (!frame) continue;
  const fb = frame.absoluteBoundingBox;
  const boxes = frame.findAll((n) => n.visible && n.absoluteBoundingBox && canReact(n)).map((n) => {
    const b = n.absoluteBoundingBox;
    return { n, x: b.x - fb.x, y: b.y - fb.y, w: b.width, h: b.height };
  });
  for (const l of links) {
    const to = PARAMS.frames[l.to];
    if (!to || !l.r) { out.unmatched.push(`${l.from} → ${l.to}: no box`); continue; }
    const [x, y, w, h] = l.r;
    // candidates cover the element's box within a small margin (the capture adds wrapper
    // boxes for margins); the tightest one wins, then the outermost of equal size
    // a margin wrapper adds a few px; a large box must not let an outer shell qualify
    const tol = Math.min(24, Math.max(8, Math.min(w, h) * 0.35));
    const hits = boxes.filter((b) => b.x <= x + tol && b.y <= y + tol && b.x + b.w >= x + w - tol && b.y + b.h >= y + h - tol
      && b.w <= w + 2 * tol + 1 && b.h <= h + 2 * tol + 1);
    if (!hits.length) { out.unmatched.push(`${l.from} → ${l.to}: ${l.r.join(',')}`); continue; }
    const area = (b) => Math.round(b.w * b.h / 50);
    const depth = (n) => { let d = 0; while (n.parent && n !== frame) { d++; n = n.parent; } return d; };
    // prefer a component occurrence (not an icon inside it), then the outermost box
    const occ = (b) => b.n.type === 'INSTANCE' && !b.n.name.startsWith('icon/');
    hits.sort((a, b) => occ(b) - occ(a) || depth(a.n) - depth(b.n) || area(a) - area(b));
    const n = hits[0].n;
    const go = (t) => [{ type: 'NODE', destinationId: to, navigation: 'NAVIGATE', transition: t, preserveScrollPosition: false, resetVideoPosition: false }];
    // a scroll step (both screens are the same view, scrolled): drag or click the scrolling box,
    // and smart animate slides the matching layers up the way the scroll does.
    // Durations and curve are the guide's: --dur-normal .22s, --dur-slow .34s, --ease.
    const ease = { type: 'CUSTOM_CUBIC_BEZIER', easingFunctionCubicBezier: { x1: 0.22, y1: 0.61, x2: 0.36, y2: 1 } };
    const reactions = l.gesture === 'scroll'
      ? ['ON_DRAG', 'ON_CLICK'].map((type) => ({ trigger: { type }, actions: go({ type: 'SMART_ANIMATE', easing: ease, duration: 0.34 }) }))
      : [{ trigger: { type: 'ON_CLICK' }, actions: go({ type: 'DISSOLVE', easing: ease, duration: 0.22 }) }];
    await n.setReactionsAsync(reactions);
    n.setSharedPluginData('uic', 'link', l.to + (l.gesture ? '~' + l.gesture : ''));
    out.wired.push(`${l.from.split('/').pop()} → ${l.to.split('/').pop()} · ${n.name.slice(0, 24)} (${n.type})`);
  }
}

// dark copies are documentation of the light screens, not a second prototype: a copy made
// after an earlier wiring carries its reactions (and link data) inside instances
const mine = new Set(PARAMS.only || Object.values(PARAMS.frames));
const darks = page.children.flatMap((c) => (c.type === 'SECTION' ? c.children : [c])).filter((n) => mine.has(n.getSharedPluginData('uic', 'darkOf')));
for (const d of darks) for (const n of d.findAll((x) => (canReact(x) && x.reactions.length) || leaked(x))) {
  if (canReact(n) && n.reactions.length) await n.setReactionsAsync([]);
  n.setSharedPluginData('uic', 'link', '');
  out.darkCleared = (out.darkCleared || 0) + 1;
}
if (PARAMS.flows.length) {
  page.flowStartingPoints = PARAMS.flows.map((f) => ({ nodeId: f.start, name: f.name }));
  out.flows = PARAMS.flows.length;
}
// component mains must not carry a link: clear what leaked from their source occurrence
const comps = PARAMS.componentsPage && await figma.getNodeByIdAsync(PARAMS.componentsPage);
if (comps) {
  await figma.setCurrentPageAsync(comps);
  let n = 0;
  for (const c of comps.findAll(leaked)) { c.setSharedPluginData('uic', 'link', ''); n++; }
  // a main made from a wired occurrence keeps its reactions, and every instance inherits them
  for (const c of comps.findAll((x) => canReact(x) && x.reactions.length)) { await c.setReactionsAsync([]); n++; }
  out.mainsCleaned = n;
}
return out;
