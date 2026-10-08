// use_figma script template — puts a fresh capture INSIDE the existing screen frame, so the
// frame keeps its id, name, position, plugin data and every link that points at it (prototype
// reactions from other screens, flow starting points, cover and flow-map hyperlinks).
// The temporary capture frame is deleted; the old dark clone is removed (rebuilt later).
const PARAMS = /*PARAMS*/ { pairs: [], page: '', place: null, titles: {} } /*END*/;
// pairs:  [[captureFrameId, screenFrameId, darkFrameId|null]] — the same id twice is a screen new
//         to the file: its capture stays as its frame, gets its title and a place in the section
// place:  { section, cols, gapX, rowH } · titles: { "<frame id>": "Screen title" }

await figma.setCurrentPageAsync(await figma.getNodeByIdAsync(PARAMS.page));
const COPY = ['layoutMode', 'itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'primaryAxisAlignItems', 'counterAxisAlignItems', 'clipsContent', 'fills', 'strokes', 'effects'];
const out = [];
const newFrames = [];
for (const [tempId, frameId, darkId] of PARAMS.pairs) {
  if (tempId === frameId) { newFrames.push(frameId); continue; }
  const temp = await figma.getNodeByIdAsync(tempId);
  const frame = await figma.getNodeByIdAsync(frameId);
  // an id that isn't a frame (a capture not in yet, a stale id) must never empty a screen
  if (!temp || !frame || temp.type !== 'FRAME' || frame.type !== 'FRAME') { out.push({ frameId, error: 'missing node' }); continue; }
  for (const c of [...frame.children]) c.remove();
  for (const k of COPY) { try { frame[k] = temp[k]; } catch (e) {} }
  if (Math.abs(frame.width - temp.width) > 0.5 || Math.abs(frame.height - temp.height) > 0.5) frame.resize(temp.width, temp.height);
  for (const c of [...temp.children]) frame.appendChild(c);
  frame.clipsContent = true;   // a menu open past the fold must not spill below the screen
  // the boxes read-tags keeps of the capture (geometry drift) belong to the capture it replaced
  frame.setSharedPluginData('uic', 'capGeo', '');
  temp.remove();
  if (darkId) { const d = await figma.getNodeByIdAsync(darkId); if (d) d.remove(); }
  out.push({ frameId, children: frame.children.length });
}
if (newFrames.length && PARAMS.place) {
  // 09-layout-screens moves every screen into its app section; until then a new screen waits in
  // the given section or, when the house layout already removed it, below everything on the page
  const sec = (PARAMS.place.section && await figma.getNodeByIdAsync(PARAMS.place.section)) || figma.currentPage;
  const kids = sec.children;
  let y0 = kids.length ? Math.max(...kids.map((c) => c.y + c.height)) + 400 : 0;
  const x0 = kids.length ? Math.min(...kids.map((c) => c.x)) : 0;
  for (let k = 0; k < newFrames.length; k++) {
    const f = await figma.getNodeByIdAsync(newFrames[k]);
    if (!f) { out.push({ frameId: newFrames[k], error: 'missing node' }); continue; }
    f.name = PARAMS.titles[f.id] || f.name;
    f.clipsContent = true;
    sec.appendChild(f);
    f.x = x0 + (k % PARAMS.place.cols) * (f.width + PARAMS.place.gapX);
    f.y = y0 + Math.floor(k / PARAMS.place.cols) * PARAMS.place.rowH;
    out.push({ frameId: f.id, added: f.name });
  }
  // the section grows to hold them (their dark copies go below each one)
  if (sec.type === 'SECTION') {
    const all = sec.children;
    const w = Math.max(...all.map((c) => c.x + c.width)) + 200;
    const h = Math.max(...all.map((c) => c.y + c.height)) + PARAMS.place.rowH / 2;
    sec.resizeWithoutConstraints(Math.max(sec.width, w), Math.max(sec.height, h));
  }
}
return out;
