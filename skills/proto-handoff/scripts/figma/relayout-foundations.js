// use_figma script template — puts an existing Foundations page in the house layout without
// re-rendering any board: one gray SECTION per topic (title + description, its boards side by
// side, light then dark), the sections in one row, top-aligned, by topic order. The same layout
// foundation-board.js leaves when it renders a topic. Re-runnable.
const PARAMS = /*PARAMS*/ { page: '', desc: {}, style: { pageBg: '#cacaca', sectionFill: '#bdbdbd', title: '#1a1c1f', subtle: '#3d3f42', gap: 200 } } /*END*/;
// PARAMS.text: the default descriptions in the docs language (lib/labels.mjs boardDesc); English by default
const TXT = Object.assign({ modes: "Light and dark mode, bound to the file's variables", single: "Bound to the file's variables" }, PARAMS.text || {});
const page = await figma.getNodeByIdAsync(PARAMS.page);
await figma.setCurrentPageAsync(page);
const ST = PARAMS.style || { pageBg: '#cacaca', sectionFill: '#bdbdbd', title: '#1a1c1f', subtle: '#3d3f42', gap: 200 };
const hex = (h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 });
const F = { r: { family: 'Inter', style: 'Regular' }, b: { family: 'Inter', style: 'Semi Bold' } };
for (const f of Object.values(F)) await figma.loadFontAsync(f);
page.backgrounds = [{ type: 'SOLID', color: hex(ST.pageBg) }];
const U = (n, k) => n.getSharedPluginData('uic', k);
// boards on the page or already inside a topic section
const boards = [];
for (const n of page.children) {
  if (U(n, 'foundation')) boards.push(n);
  else if (n.type === 'SECTION') for (const c of n.children) if (U(c, 'foundation')) boards.push(c);
}
const topics = {};
for (const b of boards) { const t = U(b, 'foundation'); (topics[t] = topics[t] || { order: +U(b, 'order') || 99, boards: [] }).boards.push(b); }
const out = { sections: [] };
for (const [topic, t] of Object.entries(topics)) {
  let sec = page.children.find((n) => n.type === 'SECTION' && U(n, 'foundationSection') === topic);
  if (!sec) { sec = figma.createSection(); page.appendChild(sec); sec.setSharedPluginData('uic', 'foundationSection', topic); }
  sec.name = topic;
  sec.setSharedPluginData('uic', 'order', String(t.order));
  sec.fills = [{ type: 'SOLID', color: hex(ST.sectionFill) }];
  for (const c of [...sec.children]) if (!U(c, 'foundation')) c.remove();
  const head = figma.createAutoLayout('VERTICAL', { name: 'header', itemSpacing: 6 }); head.fills = [];
  const h1 = figma.createText(); h1.fontName = F.b; h1.fontSize = 40; h1.characters = topic; h1.fills = [{ type: 'SOLID', color: hex(ST.title) }];
  const modes = [...new Set(t.boards.map((b) => U(b, 'mode')))];
  const h2 = figma.createText(); h2.fontName = F.r; h2.fontSize = 16;
  h2.characters = (PARAMS.desc || {})[topic] || (modes.length > 1 ? TXT.modes : TXT.single);
  h2.fills = [{ type: 'SOLID', color: hex(ST.subtle) }];
  head.appendChild(h1); head.appendChild(h2);
  sec.appendChild(head); head.x = 80; head.y = 60;
  const row = t.boards.sort((a, b) => (U(a, 'mode') === 'Light' ? -1 : 1) - (U(b, 'mode') === 'Light' ? -1 : 1));
  let x = 80;
  for (const b of row) { sec.appendChild(b); b.x = x; b.y = 200; x += b.width + 64; }
  const h = Math.max(...row.map((b) => b.height));
  sec.resizeWithoutConstraints(Math.max(x - 64 + 80, head.width + 160), 200 + h + 80);
  out.sections.push({ topic, boards: row.length, id: sec.id });
}
const secs = page.children.filter((n) => n.type === 'SECTION' && U(n, 'foundationSection')).sort((a, b) => +U(a, 'order') - +U(b, 'order'));
let sx = 0;
for (const s of secs) { s.x = sx; s.y = 0; sx += s.width + ST.gap; }
for (const n of [...page.children]) if (n.type === 'SECTION' && !U(n, 'foundationSection') && !n.children.length) n.remove();
return out;
