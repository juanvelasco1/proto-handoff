// Nesting levels of the components, from the DOM maps: a component is built and swapped after
// every component it holds, on any screen. Level = 1 + the highest level among the components
// found inside it anywhere (0 for one that holds none).
//
// Heights measured per subtree are not enough: a card that holds only plain chips on one screen
// (height 1) and a chip that holds a dot on another (height 1) land on the same level, the card
// is swapped first and its chips end up as loose frames inside the card's main.
export function levelsFromMaps(maps) {
  const kids = new Map();
  for (const m of maps) {
    const stack = [];
    for (const n of m.nodes) {
      while (stack.length && stack[stack.length - 1].d >= n.d) stack.pop();
      if (n.ui) {
        if (!kids.has(n.ui)) kids.set(n.ui, new Set());
        const host = [...stack].reverse().find((s) => s.ui);
        if (host && host.ui !== n.ui) kids.get(host.ui).add(n.ui);
      }
      stack.push({ d: n.d, ui: n.ui || null });
    }
  }
  const level = new Map();
  const visit = (ui, path) => {
    if (level.has(ui)) return level.get(ui);
    if (path.has(ui)) return 0;   // a cycle (a menu inside a menu): no ordering to respect
    path.add(ui);
    let l = 0;
    for (const k of kids.get(ui) || []) l = Math.max(l, visit(k, path) + 1);
    path.delete(ui);
    level.set(ui, l);
    return l;
  };
  for (const ui of kids.keys()) visit(ui, new Set());
  const levels = {};
  for (const [ui, l] of level) (levels[l] = levels[l] || []).push(ui);
  for (const l of Object.keys(levels)) levels[l].sort();
  return levels;
}
