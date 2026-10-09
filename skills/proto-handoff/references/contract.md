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
| `[[fx:r:8,4:sb:c]]` | A CSS flex box: direction (`r` row, `c` column, `w` if it wraps), column,row gaps, `justify-content` (`s\|e\|c\|sb\|sa\|se`) and `align-items` (`s\|e\|c\|st\|b`). The capture brings absolute boxes; with this tag the box becomes auto layout with the same distribution (wrap, space between). An optional last part, `:3g1a2`, counts the in-flow items and names the ones that grow (`g`, `flex-grow`) or that an auto margin pushes away from the item before (`a`, `margin-left: auto`): a text-only item loses its own tags in the capture, so its box carries them |
| `[[ov:e]]` | A one-line text cut with an ellipsis (`text-overflow: ellipsis`, `white-space: nowrap`, clipped). The component's text gets the same truncation, so every instance ends in "…" where the box ends |
| `[[gut:10,0]]` | The space the box sets aside for its scrollbar (right, bottom[, left]), whether it overflows or not (`scrollbar-gutter: stable`). In Figma it becomes padding before anything is compared with its tag |
| `[[as:c]]` | `align-self` of a flex or grid item when it differs from the parent's `align-items` (`c`, `e`, `s`, `st`). In Figma the parent aligns that way if all children agree; otherwise the item goes into an `align` frame |
| `[[pos:s]]` | CSS `position`: `a` absolute, `f` fixed, `s` sticky. A sticky element arrives absolute on top of its placeholder and goes back to its place in the flow |
| `[[screen:id]]` | The screen root: each capture says which screen it is (matched by name, never by order) |
| `[[wh:474x61.3]]` | The element's box. The capture wraps some elements in frames of their own (margins, an auto margin pushing right) and repeats the tag on them: the size says which layer **is** the element; the others become `margin` (outside) or `content` (inside) |
| `[[gc:f1,x360,f1]]`, `[[gr:*h]]` | The grid tracks **as the stylesheet wrote them**: `f` flexible (`fr`), `h` fits content (`auto`), `x` fixed in px. The capture only brings px; without this nobody knows which column grows |

The runtime also writes every color the capture can't read back inline as the `rgb()` it paints:
the browser computes `color-mix()` and the newer color syntaxes as `color(srgb …)`, `oklch(…)` or
`lab(…)`, and the capture dropped them (an inset ring of `color-mix(in srgb, var(--fg) 13%,
transparent)` lost its outline). Text, background, border, outline, shadow, gradient and SVG
fill and stroke colors are covered; the page looks the same.

## The adapter (`adapter.json`)

Written from the approved inventory (step 1). One JSON object:

| Key | What it is |
|---|---|
| `contract` | `"handoff-ready/1"` |
| `name`, `summary` | The product name and one line about what the file covers (cover page) |
| `platform`, `device` | `"web"` and the viewport, e.g. `[1440, 900]` |
| `themes`, `defaultTheme` | e.g. `["light", "dark"]` and `"light"` |
| `theme` | `{ storageKey, field }`: where the app keeps its theme in `localStorage`; the runtime seeds `{ [field]: theme }` before the app boots. Leave it out when the app reads `data-theme` only |
| `resetKeys` | `localStorage` keys cleared before each route, so every screen starts clean |
| `screenRoot` | Selector of the element that carries the screen tag (`#app`, `#shell`); `body` by default |
| `stepPause` | Milliseconds between recipe steps (180 by default) |
| `components` | The inventory: `[{ ui, sel, kind, stage, props, slots, list }]` (below) |
| `sections` | `[{ sel, name }]`: big regions (rail, header, content, side panel) named on the layers |
| `nav` | `[{ sel, type }]`, later entries win: `navigate`, `back`, `overlay`, `close-overlay`, `swap`, `set-state`, `none` (not a link) and `unmapped` (a control nobody classified yet; the wiring reports it) |
| `glossary` | Optional `{ term: definition }` in `docsLanguage`, printed on the cover |

A component entry:

| Key | What it is |
|---|---|
| `ui` | The component's name in Figma (PascalCase, the product's vocabulary) |
| `sel` | CSS selector of its root. Verify the count in the browser (step 1) |
| `kind` | `atom`, `component`, `list` or `container` (SKILL.md, step 1) |
| `stage` | The board on the Components page, in `docsLanguage` |
| `props` | `{ axis: [[condition, value], …, default] }`. A condition is a selector the root must match (`".on"`, `"[aria-current=page]"`, `".kan-q .agv"` for context) or, starting with `>`, a selector that must exist inside it (`"> button.value"`). The first match wins; the trailing string is the default |
| `slots` | `{ slot: selector }`: the texts (or parts) inside the root that change per use; each one becomes a text property |
| `list` | For `kind: "list"`: the `ui` of its row component |

```json
{ "ui": "StatusPill", "sel": ".pill", "kind": "component", "stage": "Status and feedback",
  "props": { "tone": [[".on", "on"], [".warn", "alert"], "off"] }, "slots": { "label": ".pill-text" } }
```

Older adapters call `stage` `etapa`; both are read.

## The flow table (`bands.json`)

The route table `migrate.mjs` builds the screens from: one band per flow, one cell per screen.

```json
[{ "k": "F0", "t": "Orders", "n": "From the list to one order.", "kind": "row",
   "cells": [
     { "id": "o-01", "t": "Orders", "s": "The list.", "steps": "C('[data-nav=orders]');", "via": null },
     { "id": "o-02", "t": "Order detail", "s": "One order open.",
       "steps": "C('[data-nav=orders]');C('.order-row');", "via": "Tap an order" }
   ] }]
```

`k` is the flow key (`F0`, `F1`…), `t` its title and `n` a note; each cell has an id, the screen
title `t`, a subtitle `s`, the recipe `steps` that reaches it from a fresh load, and `via`, the
gesture that leads there from the previous cell. The screen id is `<flow slug>/<title slug>`; two
cells with the same recipe are the same screen. `groups.json` (`[{ title, hue, flows: ["F0"] }]`)
groups flows into the sections of the Screens and User flows pages.

## Recipes

Each flow step has a recipe (clicks, typing, scrolls) that takes the prototype to that state. A
recipe step that returns a promise (waiting for a chat reply, an animation) pauses playback until it
resolves. Recipe helpers available in the page: `C(sel)`, `CN(sel,n)`, `CTXT(sel,text)`,
`TYPE(sel,value)`, `HOV(sel)`, `SCROLL(sel)` (see `scripts/lib/browser.mjs`).

**The element a step clicks becomes the hotspot of the prototype link.** `C(sel)` clicks the first
match in document order, and the rail comes before the content: a recipe `C('[data-act=open][data-id=a]')`
on a list whose cards and rail rows both open `a` wires the rail row, and the cards stay dead. Write
the selector so its first match is what a person would tap on that screen, falling back to the rail
where the card does not exist:
`C('.card[data-id="a"], body:not(:has(.card)) [data-act="open"][data-id="a"]')`. Check
`links.json` (`ui` of each link) before wiring.

## After editing the runtime

The served HTML carries the runtime embedded. After touching `scripts/runtime/contract-runtime.js`,
embed it again in the copy the server serves (`node scripts/embed-runtime.mjs <served figma.html>`)
and check it landed (for example `grep flexCode figma.html`). Skipping this once meant 30 screens
were captured with the old tags by three agents.
