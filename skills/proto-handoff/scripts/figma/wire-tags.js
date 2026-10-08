// use_figma script template — wires the clickable prototype from the link tags read by
// read-tags.js: every layer tagged with a target screen gets ON_CLICK → NAVIGATE to that
// screen's frame. Run it BEFORE the component swap: the swap carries reactions over to the
// instances (build-components.js / swap-existing.js copy them), so links survive the swap.
const PARAMS = /*PARAMS*/ { screens: [], frames: {}, flows: [], page: '' } /*END*/;
// a node that can hold prototype links: a SLOT node throws on the mere lookup of setReactionsAsync
const reacts = (n) => { if (n.type === 'SLOT') return false; try { return typeof n.setReactionsAsync === 'function' && Array.isArray(n.reactions); } catch (e) { return false; } };
// frames: { "<screen id>": "<frame id>" } for every screen in the file
// flows:  [{ name, start: "<frame id>" }] — flow starting points, set when page is given

const out = { wired: 0, unknownTarget: [] };
for (const id of PARAMS.screens) {
  const frame = await figma.getNodeByIdAsync(id);
  if (!frame) continue;
  // outermost tagged layer wins when a link tag sits on nested boxes of the same element
  for (const n of frame.findAll((x) => x.getSharedPluginData('uic', 'link') !== '')) {
    const [screen, gesture] = n.getSharedPluginData('uic', 'link').split('~');
    const to = PARAMS.frames[screen];
    if (!to) { out.unknownTarget.push(screen); continue; }
    if (to === id) continue;
    const go = (transition) => [{ type: 'NODE', destinationId: to, navigation: 'NAVIGATE', transition, preserveScrollPosition: false, resetVideoPosition: false }];
    // a scroll step (both screens are the same view, scrolled): drag or click the scrolling box,
    // and smart animate slides the matching layers up the way the scroll does
    const reactions = gesture === 'scroll'
      ? ['ON_DRAG', 'ON_CLICK'].map((type) => ({ trigger: { type }, actions: go({ type: 'SMART_ANIMATE', easing: { type: 'EASE_IN_AND_OUT' }, duration: 0.4 }) }))
      : [{ trigger: { type: 'ON_CLICK' }, actions: go({ type: 'DISSOLVE', easing: { type: 'EASE_OUT' }, duration: 0.2 }) }];
    if (reacts(n)) await n.setReactionsAsync(reactions);
    out.wired++;
  }
}
if (PARAMS.page && PARAMS.flows.length) {
  const page = await figma.getNodeByIdAsync(PARAMS.page);
  page.flowStartingPoints = PARAMS.flows.map((f) => ({ nodeId: f.start, name: f.name }));
  out.flows = PARAMS.flows.length;
}
out.unknownTarget = [...new Set(out.unknownTarget)];
return out;
