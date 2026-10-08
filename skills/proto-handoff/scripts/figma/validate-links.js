// use_figma script template (read-only) — checks the prototype against the link table: every
// link exists exactly once, on a visible layer at the element's place, and nothing else is wired.
const PARAMS = /*PARAMS*/ { page: '', frames: {}, links: [], only: null } /*END*/;
// a node that can hold prototype links: a SLOT node throws on the mere lookup of setReactionsAsync
const reacts = (n) => { if (n.type === 'SLOT') return false; try { return typeof n.setReactionsAsync === 'function' && Array.isArray(n.reactions); } catch (e) { return false; } };

const page = await figma.getNodeByIdAsync(PARAMS.page);
await figma.setCurrentPageAsync(page);
const ids = new Set(Object.values(PARAMS.frames));
const found = {};
const res = { expected: PARAMS.links.length, ok: 0, bad: [], extra: [], broken: [], darkReactions: 0 };
// only: the screens (ids of PARAMS.frames) this batch checks
const scope = PARAMS.only ? PARAMS.only.map((k) => PARAMS.frames[k]) : [...ids];
for (const fid of scope) {
  const fr = await figma.getNodeByIdAsync(fid);
  if (!fr) continue;
  const fb = fr.absoluteBoundingBox;
  for (const n of fr.findAll((x) => reacts(x) && x.reactions.length)) {
    for (const r of n.reactions) for (const a of r.actions || []) {
      if (a.type !== 'NODE') continue;
      if (!ids.has(a.destinationId)) { res.broken.push(`${fid} ${n.name} → ${a.destinationId}`); continue; }
      const b = n.absoluteBoundingBox;
      const k = fid + '>' + a.destinationId;
      found[k] = found[k] || new Map();
      found[k].set(n.id, { name: n.name, x: b.x - fb.x, y: b.y - fb.y, vis: n.visible });
    }
  }
}
const used = new Set();
for (const l of PARAMS.links) {
  const k = PARAMS.frames[l.from] + '>' + PARAMS.frames[l.to];
  used.add(k);
  const c = [...(found[k] || new Map()).values()];
  const hit = c.find((x) => x.vis && Math.abs(x.y - l.r[1]) < 24 && (Math.abs(x.x - l.r[0]) < 24 || l.r[2] > 1440));
  if (hit && c.length === 1) res.ok++;
  else res.bad.push(`${l.from.split('/').pop()} → ${l.to.split('/').pop()}: ${c.length ? c.map((x) => x.name + ' @' + Math.round(x.x) + ',' + Math.round(x.y)).join(' | ') : 'missing'}`);
}
for (const k of Object.keys(found)) if (!used.has(k)) res.extra.push(k);
if (PARAMS.only) { res.flows = page.flowStartingPoints.length; return res; }
// dark copies sit next to their screens (page level or inside a section)
const tops = page.children.flatMap((c) => (c.type === 'SECTION' ? c.children : [c]));
for (const n of tops.filter((c) => c.getSharedPluginData('uic', 'darkOf') !== ''))
  res.darkReactions += n.findAll((x) => reacts(x) && x.reactions.length).length;
res.flows = page.flowStartingPoints.map((f) => f.nodeId + ' ' + f.name);
return res;
