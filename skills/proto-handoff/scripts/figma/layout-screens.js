// use_figma script template — lays out the Screens page in the house style: one gray SECTION per
// app (groups.json), side by side and top-aligned; in each, the app's screens in a grid with
// every light frame's dark copy right below it. Frames only move, so their ids, prototype links
// and flow starting points stay. Names become "<code> · <title>" (code = the flow step where the
// screen first appears, the same code the User flows page uses). Re-runnable.
const PARAMS = /*PARAMS*/ { page: '', groups: [], cols: 4, gapX: 160, gapY: 240, darkGap: 80,
  style: { pageBg: '#cacaca', sectionFill: '#bdbdbd', title: '#1a1c1f', subtle: '#3d3f42', gap: 200 } } /*END*/;
// groups: [{ title, hue, sub, screens: [{ frame, name }] }] in order; sub (the header line) and
// PARAMS.darkSuffix come in the docs language (lib/labels.mjs), English by default

const page = await figma.getNodeByIdAsync(PARAMS.page);
await figma.setCurrentPageAsync(page);
const ST = PARAMS.style;
const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const F = { r: { family: 'Inter', style: 'Regular' }, b: { family: 'Inter', style: 'Semi Bold' } };
for (const f of Object.values(F)) await figma.loadFontAsync(f);
page.backgrounds = [{ type: 'SOLID', color: hex(ST.pageBg) }];

// frames sit directly in a section or on the page: no deep search
const top = [];
for (const n of page.children) { if (n.type === 'SECTION') top.push(...n.children); else top.push(n); }
const darkOf = new Map();
for (const n of top) { const d = n.getSharedPluginData && n.getSharedPluginData('uic', 'darkOf'); if (d) darkOf.set(d, n); }

const out = { sections: [], placed: 0, missing: [], darks: 0 };
const keep = new Set();
let sx = 0;
for (const g of PARAMS.groups) {
  let sec = page.children.find((n) => n.type === 'SECTION' && n.getSharedPluginData('uic', 'screensGroup') === g.title);
  if (!sec) { sec = figma.createSection(); page.appendChild(sec); sec.setSharedPluginData('uic', 'screensGroup', g.title); }
  keep.add(sec.id);
  sec.name = g.title;
  sec.fills = [{ type: 'SOLID', color: hex(ST.sectionFill) }];
  for (const c of sec.children.filter((c) => c.getSharedPluginData('uic', 'screensHead'))) c.remove();
  const head = figma.createAutoLayout('VERTICAL', { name: 'header', itemSpacing: 6 }); head.fills = [];
  const h1 = figma.createText(); h1.fontName = F.b; h1.fontSize = 40; h1.characters = g.title; h1.fills = [{ type: 'SOLID', color: hex(ST.title) }];
  const h2 = figma.createText(); h2.fontName = F.r; h2.fontSize = 16;
  h2.characters = g.sub || `${g.screens.length} ${g.screens.length === 1 ? 'screen' : 'screens'} · each with its dark version below`;
  h2.fills = [{ type: 'SOLID', color: hex(ST.subtle) }];
  head.appendChild(h1); head.appendChild(h2);
  if (g.hue) { const bar = figma.createRectangle(); bar.name = 'color tab'; bar.resize(120, 8); bar.fills = [{ type: 'SOLID', color: hex(g.hue) }]; head.insertChild(0, bar); }
  sec.appendChild(head); head.x = 80; head.y = 60; head.setSharedPluginData('uic', 'screensHead', '1');
  let maxX = 0, maxY = 0;
  for (let i = 0; i < g.screens.length; i++) {
    const s = g.screens[i];
    const f = await figma.getNodeByIdAsync(s.frame);
    if (!f) { out.missing.push(s.frame); continue; }
    const W = f.width, H = f.height;
    const c = i % PARAMS.cols, r = Math.floor(i / PARAMS.cols);
    const x = 80 + c * (W + PARAMS.gapX), y = 200 + r * (H * 2 + PARAMS.darkGap + PARAMS.gapY);
    sec.appendChild(f); f.x = x; f.y = y; f.name = s.name;
    const d = darkOf.get(f.id);
    if (d) { sec.appendChild(d); d.x = x; d.y = y + H + PARAMS.darkGap; d.name = s.name + (PARAMS.darkSuffix || ' · dark'); out.darks++; }
    maxX = Math.max(maxX, x + W); maxY = Math.max(maxY, y + H * 2 + PARAMS.darkGap);
    out.placed++;
  }
  sec.resizeWithoutConstraints(Math.max(maxX + 80, head.width + 160), Math.max(maxY + 80, 400));
  sec.x = sx; sec.y = 0; sx += sec.width + ST.gap;
  out.sections.push({ title: g.title, id: sec.id, screens: g.screens.length });
}
// sections left empty by the move go; one still holding frames is reported, never deleted
for (const n of [...page.children]) {
  if (n.type !== 'SECTION' || keep.has(n.id)) continue;
  if (!n.children.length) n.remove(); else out.leftover = (out.leftover || []).concat(n.name + ' (' + n.children.length + ')');
}
return out;
