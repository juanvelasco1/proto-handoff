# The contract: how the prototype tells the pipeline what each element is

Read this before step 1 (inventory) and whenever a capture comes out with wrong layer names.

## New prototypes and existing prototypes

- **New prototype**: generate it with the companion skill `proto-handoff-prototype` (published in the
  same repository as this skill, folder `open-design/proto-handoff-prototype/`). It writes
  `data-ui`, `data-ui-props`, `data-ui-slot`, `data-ui-screen`, routes `#/<screen>?theme=` and a
  `ui-manifest` directly into the HTML.
- **Existing prototype**: it is **migrated without rewriting it**. `scripts/migrate.mjs` injects a
  declarative adapter (`adapter.json`, from the inventory), the contract runtime
  (`scripts/runtime/contract-runtime.js`) and the route table built from the flow map
  (`bands.json`). The original file is never edited; the migrated copy is `figma.html` in the work
  folder (a copy handed back to the user carries the `-figma.html` suffix).

## Tags written before each capture

Before capturing, the runtime writes into each element's `aria-label` what the element is, and the
capture turns that label into the layer name. **Nothing is matched by geometry.**

| Tag | What it says |
|---|---|
| `[[ui:InboxRow\|props]]` | Root of a component, with its props |
| `[[icon:inbox]]` | A glyph from the prototype's icon dictionary |
| `[[section:rail]]`, `[[slot:label]]`, `[[n:class]]` | A section, a named text, any other box |
| `[[to:screen]]` | The element that leads to another screen |
| `[[scroll:y:8,0]]` | A scrolling box: in Figma it keeps its visible size, clipped and with scroll. After the axes, the width of its scrollbars (vertical, horizontal): the browser reserves that gap and in Figma it becomes padding, so rows do not shift |
| `[[fx:r:8,4:sb:c]]` | A CSS flex box: direction (`r` row, `c` column, `w` if it wraps), column,row gaps, `justify-content` (`s\|e\|c\|sb\|sa\|se`) and `align-items` (`s\|e\|c\|st\|b`). The capture brings absolute boxes; with this tag the box becomes auto layout with the same distribution (wrap, space between) |
| `[[gut:10,0]]` | The space the box sets aside for its scrollbar (right, bottom[, left]), whether it overflows or not (`scrollbar-gutter: stable`). In Figma it becomes padding before anything is compared with its tag |
| `[[as:c]]` | `align-self` of a flex or grid item when it differs from the parent's `align-items` (`c`, `e`, `s`, `st`). In Figma the parent aligns that way if all children agree; otherwise the item goes into an `align` frame |
| `[[pos:s]]` | CSS `position`: `a` absolute, `f` fixed, `s` sticky. A sticky element arrives absolute on top of its placeholder and goes back to its place in the flow |
| `[[screen:id]]` | The screen root: each capture says which screen it is (matched by name, never by order) |
| `[[wh:474x61.3]]` | The element's box. The capture wraps some elements in frames of their own (margins, an auto margin pushing right) and repeats the tag on them: the size says which layer **is** the element; the others become `margin` (outside) or `content` (inside) |
| `[[gc:f1,x360,f1]]`, `[[gr:*h]]` | The grid tracks **as the stylesheet wrote them**: `f` flexible (`fr`), `h` fits content (`auto`), `x` fixed in px. The capture only brings px; without this nobody knows which column grows |

## Recipes

Each flow step has a recipe (clicks, typing, scrolls) that takes the prototype to that state. A
recipe step that returns a promise (waiting for a chat reply, an animation) pauses playback until it
resolves. Recipe helpers available in the page: `C(sel)`, `CN(sel,n)`, `CTXT(sel,text)`,
`TYPE(sel,value)`, `HOV(sel)`, `SCROLL(sel)` (see `scripts/lib/browser.mjs`).

## After editing the runtime

The served HTML carries the runtime embedded. After touching `scripts/runtime/contract-runtime.js`,
embed it again in the copy the server serves (`node scripts/embed-runtime.mjs <served figma.html>`)
and check it landed (for example `grep flexCode figma.html`). Skipping this once meant 30 screens
were captured with the old tags by three agents.
