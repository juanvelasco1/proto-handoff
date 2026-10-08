// use_figma script template — swaps every occurrence of one level's components, in a batch of
// screens, for an instance of the variant it fits (built by build-level.js from all screens).
//
//   · a component takes the occurrence's texts, paints and nested swaps; the parts it doesn't
//     have are hidden (through their boolean property when there is one)
//   · a list or a container takes the occurrence's content INTO its slot: the rows and the
//     inner components move as they are (already instances, with their own overrides)
//   · an occurrence that fits no variant becomes a new variant of the same set (reported), so
//     nothing is ever left as a loose copy
const PARAMS = /*PARAMS*/ { ui: [], kinds: {}, lists: {}, screens: [], componentsPage: '', budgetMs: 40000 } /*END*/;
/*TEXT*/
/*KIT:swap*/
const T0 = Date.now();
const compPage = await figma.getNodeByIdAsync(PARAMS.componentsPage);
const uis = new Set(PARAMS.ui);
const owners = {};
for (const n of compPage.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] })) {
  const c = U(n, 'component');
  if (c && uis.has(c) && !U(n, 'old')) owners[c] = n;
}
const variantsOf = (o) => o.type === 'COMPONENT_SET' ? o.children.filter((c) => c.type === 'COMPONENT') : [o];
const fitsRoot = (o, r) => sameCols(o, r) && (!('children' in o) || !o.children.length ? !('children' in r) || !r.children.length : !!('children' in r && pick(o.children, r.children)));
// a variant made where no slot could go (a many-column grid) takes only identical structures
const sameKids = (o, r) => sameCols(o, r) && 'children' in o && 'children' in r && o.children.length === r.children.length && !!pick(o.children, r.children);
const specOf = (v) => { const s = U(v, 'spec'); return s ? JSON.parse(s) : null; };
const boolsOf = (v) => { const s = U(v, 'bools'); return s ? JSON.parse(s) : null; };
// the axes a slotted instance sizes by its content: the ones the page sized its occurrence by
// (box: boxOf) and the ones its main hugs. An instance without a slot takes the page's sizes.
// vBox: the height hugs only because the page's box did, so place() holds it to the page's
const hugOf = (main, spec, box) => (!spec ? { h: false, v: false, vBox: false } : {
  h: box.layoutSizingHorizontal === 'HUG' || hugsAxis(main, true),
  v: box.layoutSizingVertical === 'HUG' || hugsAxis(main, false),
  vBox: box.layoutSizingVertical === 'HUG' && !hugsAxis(main, false),
});

// a chrome box keeps the size its page drew on each axis it doesn't fill: a header whose meta
// wrapped to a second line is 38 px where the main's is 19, and kept at 19 it pulls the content
// under it up by the difference. Only boxes (frames, instances): a text sizes itself from the
// characters it just took, and a group or a shape would scale what it draws.
// An instance's sublayer takes no length of its own: resize() leaves it as it was without a word
// and its min and max sizes can't be overridden. It can only hug its content or run its parent's
// length, so it takes whichever of the two lands on the page's length; one that neither does is
// reported (sizeMisses) with the length it kept
const sizeMisses = [];
function carrySize(a, d) {
  if (!('layoutMode' in d)) return 0;
  let n = 0;
  for (const h of [true, false]) {
    const key = h ? 'layoutSizingHorizontal' : 'layoutSizingVertical';
    const len = h ? a.width : a.height, now = () => (h ? d.width : d.height);
    if (d[key] === 'FILL' || Math.abs(len - now()) <= 2) continue;
    const was = d[key], len0 = now(), got = [[was, len0]];
    let ok = false;
    for (const mode of ['HUG', 'FILL']) {
      if (mode === was) continue;
      try { d[key] = mode; } catch (e) { continue; }
      got.push([mode, now()]);
      if (Math.abs(len - now()) <= 2) { ok = true; break; }
    }
    if (!ok) {
      // neither lands: the closest of what it had and what it tried. A fixed length can't be
      // given back once a mode moved it, so a fixed one that was closest settles on the mode that
      // came nearest its old length before it is fixed again
      got.sort((x, y) => Math.abs(x[1] - len) - Math.abs(y[1] - len));
      const best = got[0][0];
      try {
        if (best === 'FIXED') { const near = got.filter((x) => x[0] !== 'FIXED').sort((x, y) => Math.abs(x[1] - len0) - Math.abs(y[1] - len0))[0]; if (near) d[key] = near[0]; }
        d[key] = best;
      } catch (e) {}
      try { fixAxis(d, h, len); } catch (e) {}
      ok = Math.abs(len - now()) <= 2;
    }
    if (ok) n++;
    else sizeMisses.push([U(d, 'ui') || d.name, h ? 'w' : 'h', +len.toFixed(1), +now().toFixed(1)]);
  }
  return n;
}
// the chrome of a slotted occurrence onto its instance, by index (outside the slot they match).
// carry gets each part with the size the page drew it at: the sizes are carried once the instance
// stands in the page at its own size (a header wraps only at the card's width, not the main's)
async function copyChrome(o, inst, spec, carry) {
  let n = await copyShallow(o, inst, true);
  let a = o, d = inst;
  const part = async (x, y) => { carry.push([y, { width: x.width, height: x.height }]); return copyOverrides(x, y, null, false); };
  for (let depth = 0; depth <= spec.path.length; depth++) {
    const last = depth === spec.path.length;
    const pre = last ? spec.pre : spec.path[depth];
    const post = last ? spec.post : a.children.length - pre - 1;
    for (let i = 0; i < pre; i++) n += await part(a.children[i], d.children[i]);
    for (let i = 1; i <= post; i++) n += await part(a.children[a.children.length - i], d.children[d.children.length - i]);
    if (last) break;
    a = a.children[pre]; d = d.children[pre];
    n += await copyShallow(a, d, false);
  }
  return n;
}
// a new variant from an occurrence that fits none: same props, next tipo
function addVariant(ui, o) {
  let owner = owners[ui];
  const props = U(o, 'props');
  const clone = o.clone();
  compPage.appendChild(clone);
  const size0 = [o.width, o.height];
  const comp = figma.createComponentFromNode(clone);
  try {
    if (comp.layoutMode === 'HORIZONTAL' || comp.layoutMode === 'VERTICAL') { comp.primaryAxisSizingMode = 'FIXED'; comp.counterAxisSizingMode = 'FIXED'; }
    comp.resize(Math.max(size0[0], 0.01), Math.max(size0[1], 0.01));
  } catch (e) {}
  SET(comp, 'props', props); SET(comp, 'spec', ''); SET(comp, 'bools', '{}'); SET(comp, 'members', '1'); SET(comp, 'added', '1');
  SET(comp, 'match', slotted(ui) ? 'exact' : '');
  const vs = variantsOf(owner);
  const tipos = vs.map((v) => +(v.name.match(/tipo=(\d+)/) || [0, 0])[1]);
  const next = Math.max(1, ...tipos) + 1;
  const base = props.trim() ? variantName(props) : '';
  if (owner.type === 'COMPONENT') {
    // a single component becomes a set: its instances stay linked (same node)
    const first = owner;
    first.name = [U(first, 'props').trim() ? variantName(U(first, 'props')) : '', 'tipo=1'].filter(Boolean).join(', ');
    comp.name = [base, 'tipo=2'].filter(Boolean).join(', ');
    const set = figma.combineAsVariants([first, comp], first.parent.type === 'PAGE' ? compPage : first.parent);
    set.name = ui; SET(set, 'component', ui); SET(set, 'kind', U(first, 'kind') || kindOf(ui)); SET(first, 'component', '');
    set.layoutMode = 'HORIZONTAL'; set.layoutWrap = 'WRAP'; set.itemSpacing = 40; set.counterAxisSpacing = 40;
    set.paddingLeft = set.paddingRight = set.paddingTop = set.paddingBottom = 40;
    set.primaryAxisSizingMode = 'AUTO'; set.counterAxisSizingMode = 'AUTO';
    set.description = first.description;
    owners[ui] = set;
  } else {
    // every variant needs the tipo axis once one of them has it
    if (!tipos.some(Boolean)) for (const v of vs) v.name = v.name + ', tipo=1';
    comp.name = [base, 'tipo=' + next].filter(Boolean).join(', ');
    owner.appendChild(comp);
  }
  return comp;
}

const report = {};
// resumable: past the budget the swap stops between occurrences; this screen and the ones after
// it come back in _pending and the same call runs again (what is an instance already is skipped)
const BUDGET = PARAMS.budgetMs || 40000;
screens: for (const [idx, id] of PARAMS.screens.entries()) {
  const f = await figma.getNodeByIdAsync(id);
  if (!f) { report[id] = 'missing'; continue; }
  for (const o of occurrences(f, uis)) {
    await breathe();
    if (Date.now() - T0 > BUDGET) { report._pending = PARAMS.screens.slice(idx); break screens; }
    if (o.removed) continue;
    const ui = U(o, 'ui');
    const r = report[ui] = report[ui] || { swapped: 0, added: 0, failed: 0, hidden: 0 };
    if (!owners[ui]) { r.failed++; o.name = ui + ' · no component'; continue; }
    const props = U(o, 'props');
    let V = null, spec = null;
    for (const v of variantsOf(owners[ui]).filter((x) => U(x, 'props') === props)) {
      const s = specOf(v);
      if (s ? chromeFits(o, v, s) : U(v, 'match') === 'exact' ? sameKids(o, v) : fitsRoot(o, v)) { V = v; spec = s; break; }
    }
    if (!V) { V = addVariant(ui, o); r.added++; }
    let inst = null, placed = false;
    const carry = [];
    try {
      // o's box and the room between its rows as the page drew them, read before anything leaves
      // o: a frame that hugs its rows shrinks as they go (a tab bar ended as wide as its last tab)
      const box = boxOf(o);
      const range = spec && !spec.cells ? slotRange(o, spec) : null;
      const gaps = range && runGaps(nodeAt(o, spec.path), range);
      inst = V.createInstance();
      if (spec && spec.cells) {
        // the row's own paints and its fixed cells, then each changing cell's content into its slot
        await copyShallow(o, inst, true);
        for (let i = 0; i < o.children.length; i++) {
          if (spec.cells.includes(i)) await copyShallow(o.children[i], inst.children[i], false);
          else await copyOverrides(o.children[i], inst.children[i]);
        }
        if (!fillCells(o, inst, spec)) throw new Error('cell slots not found');
      } else if (spec) {
        await copyChrome(o, inst, spec, carry);
        if (!range || !fillSlot(inst, spec, range, gaps)) throw new Error('slot content not found');
      } else {
        await copyInto(o, inst, V, boolsOf(V));
      }
      inst.name = ui;
      place(o, inst, hugOf(V, spec, box), box);
      placed = true;
      for (const [d, a] of carry) carrySize(a, d);
      r.swapped++;
    } catch (e) {
      if (inst && !placed && !inst.removed) inst.remove();
      r.failed++; r.error = String(e).slice(0, 160);
      if (!o.removed) o.name = ui + ' · unchanged';
    }
  }
}
// a box that scrolls inside an instance takes its direction from its main: Figma keeps
// overflowDirection out of an instance's overrides (setting it throws, even on an instance placed
// inside another main), so the main scrolls that way too — where its content fits, nothing moves.
// Merged with the axes the main already had.
const AX = { NONE: '', HORIZONTAL: 'x', VERTICAL: 'y', BOTH: 'xy' };
const DIR = (a) => (/x/.test(a) && /y/.test(a) ? 'BOTH' : /x/.test(a) ? 'HORIZONTAL' : /y/.test(a) ? 'VERTICAL' : 'NONE');
report._scrollMains = 0;
for (const id of PARAMS.screens) {
  const f = await figma.getNodeByIdAsync(id);
  if (!f) continue;
  for (const n of f.findAll((n) => !!U(n, 'scroll') && 'overflowDirection' in n && (n.type === 'INSTANCE' || n.id.startsWith('I')))) {
    const want = U(n, 'scroll'), has = AX[n.overflowDirection] || '';
    if (n.clipsContent && [...want].every((a) => has.includes(a))) continue;
    let t = n.type === 'INSTANCE' ? await n.getMainComponentAsync() : await figma.getNodeByIdAsync(n.id.split(';').pop());
    while (t && t.type === 'INSTANCE') t = await t.getMainComponentAsync();
    if (!t || !('overflowDirection' in t)) continue;
    try { t.clipsContent = true; t.overflowDirection = DIR((AX[t.overflowDirection] || '') + want); report._scrollMains++; } catch (e) {}
  }
}
report._ms = Date.now() - T0;
report._textWarnings = textWarnings;
report._gridWarnings = gridWarnings;
report._gridMisses = gridMisses;
report._sizeMisses = sizeMisses.concat(swapMisses);
return report;
