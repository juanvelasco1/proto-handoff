// use_figma script template — READ-ONLY. Maps the captures on a page to their screens by the
// [[screen:<id>]] tag the runtime puts on the screen root (uic.screenRoot once read-tags ran).
// This is the authoritative capture ↔ screen table: a record written while polling misses a
// capture that finished late, and a stuck capture retried with a new id leaves two frames for
// one screen. Captures land at page level; screen frames that hold a capture sit in sections.
const PARAMS = /*PARAMS*/ { page: '', exclude: [] } /*END*/;
// exclude: page-level frames that are not captures (screen frames not yet in a section)

const page = await figma.getNodeByIdAsync(PARAMS.page);
await figma.setCurrentPageAsync(page);
// the screen tag sits among the root's other tags ([[n:shell][screen:id][wh:1440x900]])
const TAG = /\[screen:([^\]]+)\]/;
const tagOf = (n) => ((n.name.match(TAG) || [])[1]) || n.getSharedPluginData('uic', 'screenRoot') || null;
// the screen root sits a few levels under the capture's body: breadth-first, shallow
const screenOf = (f) => {
  let level = [f];
  for (let d = 0; d < 6 && level.length; d++) {
    for (const n of level) { const s = tagOf(n); if (s) return s; }
    level = level.flatMap((n) => ('children' in n && n.type !== 'INSTANCE' ? n.children : []));
  }
  return null;
};
const skip = new Set(PARAMS.exclude);
const found = {}, untagged = [];
for (const f of page.children) {
  if (f.type !== 'FRAME' || skip.has(f.id)) continue;
  const s = screenOf(f);
  if (!s) { untagged.push({ id: f.id, name: f.name.slice(0, 60) }); continue; }
  (found[s] = found[s] || []).push(f.id);
}
// one capture per screen: the first one in; any later frame for the same screen is a duplicate
const captures = {}, duplicates = {};
for (const [s, ids] of Object.entries(found)) { captures[s] = ids[0]; if (ids.length > 1) duplicates[s] = ids.slice(1); }
return { captures, duplicates, untagged, count: Object.keys(captures).length };
