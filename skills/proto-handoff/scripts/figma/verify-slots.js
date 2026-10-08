// use_figma script template — checks every component instance's slot texts against the
// browser (the DOM map's slots for the same occurrence) and fixes what differs.
// Guards against a text property bound to the wrong layer, a default value leaking into
// instances, or an override lost in the swap. Safe to re-run: it only writes differences.
// Occurrences pair with instances by ORDER, per component: the k-th InboxRow the browser drew is
// the k-th InboxRow instance in the frame (every occurrence is listed, with or without slot
// texts, so the order holds). When the counts differ nothing is written: pairing by nearness
// wrote a row's text into its neighbor wherever the layout sat a row off.
const PARAMS = /*PARAMS*/ { page: '', slots: {} } /*END*/;
// slots: { "<frame id>": [[ui, x, y, { slot: text }, optional?], …] }  (DOM order, x, y relative to the frame)
// optional: an occurrence the browser folded into its parent; it counts only when the instance
// count says the capture kept its layer

const page = await figma.getNodeByIdAsync(PARAMS.page);
await figma.setCurrentPageAsync(page);
const U = (n, k) => n.getSharedPluginData('uic', k);
const out = { checked: 0, fixed: [], unmatched: [], noSlotLayer: [] };
const loadFonts = async (t) => { for (const s of t.getStyledTextSegments(['fontName'])) await figma.loadFontAsync(s.fontName); };
const flat = (x) => x.replace(/\s+/g, '');
// the instance's own layers: a nested instance or a slot's content has slots of its own
const own = (root, pred) => { let hit = null; const w = (n) => { for (const c of n.children || []) { if (hit) return; if (c.type === 'INSTANCE' || c.type === 'SLOT') continue; if (pred(c)) { hit = c; return; } w(c); } }; w(root); return hit; };

for (const [fid, occs] of Object.entries(PARAMS.slots)) {
  const frame = await figma.getNodeByIdAsync(fid);
  if (!frame || !occs.length) continue;
  const fb = frame.absoluteBoundingBox;
  // visible instances by component, in tree order (instances inside instances and slots included)
  const byUi = {};
  const walk = (n) => {
    for (const c of n.children || []) {
      if (c.visible === false) continue;
      if (c.type === 'INSTANCE' && U(c, 'ui')) { const b = c.absoluteBoundingBox; (byUi[U(c, 'ui')] = byUi[U(c, 'ui')] || []).push({ i: c, x: b.x - fb.x, y: b.y - fb.y }); }
      walk(c);
    }
  };
  walk(frame);
  const domBy = {};
  for (const o of occs) (domBy[o[0]] = domBy[o[0]] || []).push(o);
  for (const [ui, all] of Object.entries(domBy)) {
    const got = byUi[ui] || [];
    const plain = all.filter((o) => !o[4]);
    const list = got.length === all.length ? all : plain;
    const pairs = [];
    if (got.length === list.length) list.forEach((o, k) => pairs.push([o, got[k]]));
    // counts that differ say the structure is not to be trusted: nothing is written (pairing by
    // nearness wrote a row's title into its neighbour when a block sat one row off), the census
    // audit (A2) reports the count
    else out.unmatched.push(`${fid} ${ui} (${list.length} vs ${got.length})`);
    for (const [[, , , slots], s] of pairs) {
      const inst = s.i;
      out.checked++;
      for (const [slot, want] of Object.entries(slots)) {
        if (!want) continue;
        const box = own(inst, (n) => U(n, 'slot') === slot);
        const texts = box ? (box.type === 'TEXT' ? [box] : box.findAll((n) => n.type === 'TEXT' && n.visible !== false)) : [];
        if (!texts.length) { out.noSlotLayer.push(`${ui}.${slot}`); continue; }
        // the browser's slot text is the element's whole textContent: a slot made of several
        // text layers (title + subtitle) is compared as a whole and left alone when it matches
        if (flat(texts.map((x) => x.characters).join('')) === flat(want)) continue;
        if (texts.length > 1) { out.noSlotLayer.push(`${ui}.${slot} (several texts)`); continue; }
        const t = texts[0];
        const have = t.characters.replace(/\s+/g, ' ').trim();
        const ref = t.componentPropertyReferences && t.componentPropertyReferences.characters;
        let done = false;
        if (ref) { try { inst.setProperties({ [ref]: want }); done = true; } catch (e) {} }
        if (!done) { await loadFonts(t); t.characters = want; }
        out.fixed.push(`${ui}.${slot}: '${have.slice(0, 16)}' → '${want.slice(0, 16)}'`);
      }
    }
  }
}
out.noSlotLayer = [...new Set(out.noSlotLayer)];
out.fixedCount = out.fixed.length; out.fixed = out.fixed.slice(0, 30);
out.unmatchedCount = out.unmatched.length; out.unmatched = out.unmatched.slice(0, 20);
return out;
