// use_figma script template — gives existing layers a component identity the adapter gained
// after they were captured (a new "components" entry, or new props), without recapturing:
// the DOM map says which box is now a component; the matcher finds its layer by box.
// Writes the same plugin data read-tags.js writes from a tagged capture (ui, props, slots and
// the slot layers), so build-components / swap-existing treat it like any other occurrence.
// A box that sits inside an existing instance can't be tagged here: it is reported (its host
// component has to be rebuilt).
/*MATCHER*/
const PARAMS = /*PARAMS*/ { screens: [] } /*END*/;   // [{ frame, ops: [{ r, d, name, tag|null }] }]

const out = {};
for (const s of PARAMS.screens) {
  const root = await figma.getNodeByIdAsync(s.frame);
  if (!root) { out[s.frame] = 'missing'; continue; }
  const hit = matchAll(root, s.ops.map((o) => ({ r: o.r, d: o.d })));
  const st = { tagged: 0, miss: [], inInstance: [] };
  s.ops.forEach((o, i) => {
    if (!o.tag) return;
    const n = hit.get(i);
    if (!n) { st.miss.push(`${o.tag.ui}@${o.r.slice(0, 2).map(Math.round).join(',')}`); return; }
    let p = n.parent, host = null;
    while (p && p !== root) { if (p.type === 'INSTANCE') host = p; p = p.parent; }
    if (host) { st.inInstance.push(`${o.tag.ui} in ${host.name}`); return; }
    n.setSharedPluginData('uic', 'ui', o.tag.ui);
    n.setSharedPluginData('uic', 'props', o.tag.props || '');
    n.name = o.tag.ui;
    const slots = o.tag.slots || {};
    // slot layers: the text whose characters are the slot's text, not inside a nested component
    const flat = (x) => x.replace(/\s+/g, ' ').trim();
    for (const [slot, text] of Object.entries(slots)) {
      const t = n.findAllWithCriteria({ types: ['TEXT'] }).find((x) => flat(x.characters) === flat(text))
        || n.findAllWithCriteria({ types: ['TEXT'] }).find((x) => flat(text).startsWith(flat(x.characters)) && x.characters.trim());
      if (t) t.setSharedPluginData('uic', 'slot', slot);
    }
    if (Object.keys(slots).length) n.setSharedPluginData('uic', 'slots', JSON.stringify(slots));
    st.tagged++;
  });
  st.inInstance = [...new Set(st.inInstance)];
  out[s.frame] = st;
}
return out;
