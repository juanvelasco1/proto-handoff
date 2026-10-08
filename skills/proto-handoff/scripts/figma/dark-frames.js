// use_figma script template — the dark theme is not a second capture: each light frame is
// cloned below itself with the Tokens collection pinned to its Dark mode, so both themes stay
// one design bound to the same variables. Run it after the component swap (clones then hold
// instances too) and before wiring the prototype (clones must not inherit light-frame links).
const PARAMS = /*PARAMS*/ { frames: [], collection: 'Tokens', mode: 'Dark', gap: 200 } /*END*/;
// a node that can hold prototype links: a SLOT node throws on the mere lookup of setReactionsAsync
const reacts = (n) => { if (n.type === 'SLOT') return false; try { return typeof n.setReactionsAsync === 'function' && Array.isArray(n.reactions); } catch (e) { return false; } };

const col = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === PARAMS.collection);
const mode = col.modes.find((m) => m.name === PARAMS.mode);
const out = [];
let fontErrors = 0;
for (const id of PARAMS.frames) {
  const light = await figma.getNodeByIdAsync(id);
  const name = light.name + ' · ' + PARAMS.mode;
  // re-runnable: replace this frame's previous dark clone. Found by darkOf, never by name:
  // two screens can share a title ("Filters menu" in two apps) and a name match deleted the
  // other screen's dark copy.
  for (const old of light.parent.children.filter((n) => n.getSharedPluginData('uic', 'darkOf') === id)) old.remove();
  const fonts = new Map();
  for (const t of light.findAllWithCriteria({ types: ['TEXT'] })) {
    if (!t.characters.length) continue;
    for (const s of t.getStyledTextSegments(['fontName'])) fonts.set(JSON.stringify(s.fontName), s.fontName);
  }
  for (const f of fonts.values()) { try { await figma.loadFontAsync(f); } catch (e) { fontErrors++; } }
  const dark = light.clone();
  light.parent.appendChild(dark);
  dark.name = name;
  dark.x = light.x; dark.y = light.y + light.height + PARAMS.gap;
  dark.setExplicitVariableModeForCollection(col, mode.modeId);
  dark.setSharedPluginData('uic', 'darkOf', id);
  for (const n of dark.findAll((n) => reacts(n) && n.reactions.length)) await n.setReactionsAsync([]);
  out.push({ light: id, dark: dark.id });
}
// a clone of a flow's first screen becomes a starting point too: only light frames start flows
let pg = out.length ? await figma.getNodeByIdAsync(out[0].light) : null;
while (pg && pg.type !== 'PAGE') pg = pg.parent;
const darkIds = new Set(out.map((o) => o.dark));
if (pg) pg.flowStartingPoints = pg.flowStartingPoints.filter((f) => !darkIds.has(f.nodeId));
return { frames: out, fontErrors };
