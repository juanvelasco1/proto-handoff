// use_figma script template — READ-ONLY. A fingerprint of what the skill built, to tell later
// whether someone edited it by hand in Figma. update.mjs takes one right after a successful
// build or update (the baseline) and another one before the next update (current); a screen,
// component or variable whose fingerprint changed in between was edited in Figma.
//
// The hash covers what a designer changes and the skill writes: layer type, name, visibility,
// size and position (rounded to 1 px), text, fills and strokes (color or bound variable),
// corner radius, auto layout, the component an instance uses and its property values. It skips
// ids and anything Figma recomputes on its own.
const PARAMS = /*PARAMS*/ { screens: [], componentsPage: null, variables: false, budgetMs: 35000 } /*END*/;
// screens: [{ screen, frame, dark }]   componentsPage: page id or null   variables: true to hash them

const t0 = Date.now();
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const r1 = (v) => (typeof v === 'number' ? Math.round(v) : v);
const paint = (p) => {
  if (!p || p.visible === false) return '';
  const bound = p.boundVariables && p.boundVariables.color ? 'v' + p.boundVariables.color.id : '';
  if (p.type === 'SOLID') return bound || [p.color.r, p.color.g, p.color.b, p.opacity ?? 1].map((c) => Math.round(c * 255)).join('.');
  return p.type;
};
const paints = (list) => (Array.isArray(list) ? list.map(paint).join(',') : 'mixed');
const sig = (n) => {
  const parts = [n.type, n.name, n.visible === false ? 'h' : '', r1(n.width), r1(n.height), r1(n.x), r1(n.y)];
  if ('fills' in n) parts.push(paints(n.fills));
  if ('strokes' in n) parts.push(paints(n.strokes), typeof n.strokeWeight === 'number' ? r1(n.strokeWeight) : 'm');
  if ('cornerRadius' in n) parts.push(typeof n.cornerRadius === 'number' ? r1(n.cornerRadius) : 'm');
  if ('layoutMode' in n && n.layoutMode !== 'NONE') parts.push(n.layoutMode, r1(n.itemSpacing), r1(n.paddingTop), r1(n.paddingRight), r1(n.paddingBottom), r1(n.paddingLeft), n.primaryAxisAlignItems, n.counterAxisAlignItems);
  if (n.type === 'TEXT') parts.push(n.characters, typeof n.fontSize === 'number' ? n.fontSize : 'm', typeof n.fontName === 'object' && n.fontName.family ? n.fontName.family + ' ' + n.fontName.style : 'm');
  return parts.join('|');
};
const walk = async (root) => {
  let acc = 2166136261, count = 0;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    let s = sig(n);
    if (n.type === 'INSTANCE') {
      const main = await n.getMainComponentAsync();
      s += '|m:' + (main ? main.id : 'none');
      try { s += '|p:' + JSON.stringify(Object.entries(n.componentProperties || {}).map(([k, v]) => [k, v.value]).sort()); } catch (e) { s += '|p:?'; }
    }
    acc = Math.imul(acc ^ fnv(s), 16777619) >>> 0;
    count++;
    if ('children' in n) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  return { h: acc.toString(36), n: count };
};

// Past the time budget the rest is reported as `incomplete` (not `pending`: a rerun would start
// over and stop at the same place). update.mjs treats an incomplete screen as "not checked".
const screens = {}, missing = [], incomplete = [];
for (const s of PARAMS.screens) {
  if (Date.now() - t0 > PARAMS.budgetMs) { incomplete.push(s.screen); continue; }
  const entry = {};
  for (const k of ['frame', 'dark']) {
    if (!s[k]) continue;
    const node = await figma.getNodeByIdAsync(s[k]);
    if (!node) { entry[k] = null; missing.push(`${s.screen}.${k}`); continue; }
    entry[k] = await walk(node);
  }
  screens[s.screen] = entry;
}

let components = null;
if (PARAMS.componentsPage) {
  components = {};
  const page = await figma.getNodeByIdAsync(PARAMS.componentsPage);
  if (page) {
    await page.loadAsync();
    const mains = page.findAll((n) => (n.type === 'COMPONENT_SET' || (n.type === 'COMPONENT' && (!n.parent || n.parent.type !== 'COMPONENT_SET'))));
    for (const m of mains) {
      if (Date.now() - t0 > PARAMS.budgetMs) { incomplete.push('component:' + m.id); continue; }
      components[m.id] = Object.assign({ name: m.name }, await walk(m));
    }
  } else missing.push('componentsPage');
}

let variables = null;
if (PARAMS.variables) {
  variables = {};
  for (const col of await figma.variables.getLocalVariableCollectionsAsync()) {
    for (const id of col.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (!v) continue;
      variables[col.name + '/' + v.name] = fnv(JSON.stringify(v.valuesByMode)).toString(36);
    }
  }
}

return { screens, components, variables, missing, incomplete };
