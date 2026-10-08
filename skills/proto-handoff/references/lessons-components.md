# Lessons from real runs: components, instances and pages

Read this before touching the builder templates (`build-level.js`, `swap-level.js`,
`scripts/lib/figma-kit.js`) and whenever a component, instance or page comes out wrong. Each rule
came from a real failure; the templates already apply them. A fix goes into the template, never by
hand into one file.

## Components

- **A photo is compared as a photo, not by its name.** The capture names each `<img>` after its alt
  text ("Reference AB01234…"), one per photo: compared by name, 48 photos in one sheet gave 27
  variants. `partKey` treats them all as `P`. And a single photo in a box that centers it is
  `object-fit: contain`: it fills the box and the image fits (`FIT`), because the capture gave the
  layer that photo's width and an instance cannot change a layer's size.
- **A component's shape does not include widths or positions.** Counting them gave 142 variants of
  a product row and 48 of a timeline row; with props × structure they are 3 and 2.
- **A table does not keep all its rows in the main.** With 279 rows it measured 12,455 px. The rows
  go into the slot and the main shows 5; a table with scroll keeps its visible height (without that,
  the main of a long table measured 4,090 px).
- **A layout container is not a component.** `.page-grid` was the grid of every page: it produced
  33 "variants" that were whole pages. A container is a component when it has its own chrome
  (background, border, radius, shadow) or repeats as a piece.
- **A container's chrome is compared by instance identity**: with "it is an instance" as the only
  test, two panels with different lists looked equal and the swap failed.
- **An instance carries its main's tag.** `uic.ui` is inherited: the occurrence search skips
  instances and what is inside them, which is why repeating a batch is safe.
- **Merging variants is not `swapComponent`**: it loses the overrides. Never merge that way; if
  there are duplicates, delete them and recapture the affected screens into their frames.
- **Remove before placing.** In a grid, inserting the instance before removing the occurrence opens
  a new row and stretches the cell. Grid anchors are set with `setGridChildPosition`.
- **Overrides go into nested instances** (the initials of an avatar inside a row).
- **Cards in a grid row that hugs cannot fill it**: they wait for each other and collapse
  (`StatCard` ended up at 0 px). What stretched becomes hug.
- **Icons are components**, named after the prototype's dictionaries (`L`, `S`, `S.cube = …`); what
  is not in one is called `glyph-<hash>`.
- **Duplicated tags**: the capture repeats the tag on the wrapper frames it creates (a margin is a
  frame with padding; an auto margin, a `FILL` frame aligned to the end). The layer whose size is the
  element's (`wh`) is kept; the ones outside are named `margin` and the ones inside `content`.
  Keeping the outermost put the margins inside the components: the rail row came out with 7 px of
  padding, the access label was a 1 px `FILL` frame and the section header changed variant because
  of its margin. Margins equal across all siblings become the parent's `itemSpacing`, so a list holds
  its rows directly.
- **A row is what carries the row's tag** (or an instance with its name). Taking any instance as a
  row put into the timeline's slot everything up to the last instance: 274 grid lines.
- **What is measured is measured before touching anything**: `settle` fixed at its "current" size a
  piece that had already collapsed (26×1). First do not collapse (nothing fills a hugging axis), then
  fix.
- **The occurrence is measured before emptying it** (`boxOf`): filling the slot takes the rows out
  of the occurrence and a frame that hugged its content shrinks. Measured afterwards, the tab bar
  ended up as wide as its last tab and each detail card at 186 px (just its chrome). What the page
  hugged stays hugging in the instance, axis by axis.
- **In a grid, first the cell and then the span** (`toCell`): with the span first, a 3-column span
  placed in column 1 did not fit, the error was swallowed and the section jumped to the other column.
  Cells that do not land where they should are reported (`_gridMisses`).
- **The instance carries what its occurrence had different**: the gap between its rows (a grid of
  3 cards with gap 8 did not fit with the main's 14 and dropped to 2 per line) and the size of its
  fixed parts (a header that takes two lines on that screen).
- **Filling an axis requires having filled it in the browser**: a cell fills its track only if it
  measures what the track measured in the capture (`gpx`), and never if it was centered (the account
  avatar grew from 22 to 26 px); a single column whose occurrences change width is flexible (the
  property fields all ended up at 242 px).
- **The main does not inherit the caps of its first occurrence**: a note's `max-width: 72ch` held
  back all the others; caps stay only if every occurrence agrees. A text that wraps in some
  occurrence wraps in the main.
- **The border counts** when deciding whether a frame hugs its content (`strokesIncludedInLayout`).
- **Capture rounding is not a margin**: the capture rounds to the pixel (80 for 79.3); a baked
  margin needs real padding. And when an element leaves its wrapper it comes back with its own size
  and without the wrapper's `grow` (the app title took all the free space).

## Instances, sizes and layout

- **An instance's layers have no size of their own**: `resize()` on a sublayer does nothing and
  does not warn, and `minWidth`/`maxWidth`/`minHeight`/`maxHeight` cannot be overridden ("This
  property cannot be overridden in an instance"). Only the mode is overridden (`HUG`, `FILL`,
  `FIXED`). So the size of a fixed part the browser drew differently (a header whose meta dropped to
  a second line: 38 px where the main has 19) travels through the mode that reproduces it:
  `carrySize` tries hug and fill, checks the measure and, if neither gets there, reports the part in
  `_sizeMisses`. Same when a nested instance is swapped to another component (`swapComponent` keeps
  the previous size: a 26 px mark inherited the bar's 2,536 px). The children of a **SLOT** do belong
  to the page: they move and resize.
- **A layer that sits elsewhere or is something else on each line is content, not a fixed part**:
  an instance does not take positions. `samePlace` treats free layers as moved when the track holds
  other layers than the representative's (a mark where the representative has a bar and a tone), and
  the cell becomes a slot (`cellSpec`).
- **The scroll gutter also narrows what ran full width**: the capture drew over the bar and
  everything that took the content width came out 10 px wider than in the browser (its `wh` tag says
  so). After adding the gutter as padding, those boxes go back to their parent's width (`FILL` in a
  column, the width of their tag in a free frame), top to bottom; without it neither the stretch
  (`as:st`) nor the baked margin is recognized (a 648 px chat turn with 14 px of margin on top).
- **A fixed part's size is carried once the instance is on the page at its size**: a header wraps
  at its card's width (330), not the main's (1,132). `carrySize` runs after `place()`.
- **The item that grows in a row (`flex: 1`) is FILL in the main**: it is recognized by comparing
  occurrences (in all of them it fills what its line leaves free and its width changes from one to
  another). Fixed in the main, a narrower instance cannot shrink it (a 1,039 px title in a 330 px row
  pushed the date to another line). An empty item has no layer in the capture but keeps its gap in
  the browser: the line counts one more gap (a title 14 px short of the end of its row). Figma draws
  texts narrower or wider than the browser: each text on the line adds 6 % of its width to the
  tolerance. What changes width without filling its line shows up in `_growMisses` of the report.
- **A rebuilt flex row keeps the space under its line as padding** (`padding: 8px 0`): without it,
  the row that then hugs its content is 8 px shorter. It is read where the capture put the items,
  **before** giving the frame auto layout: read afterwards, the second line of a header and the chips
  of a wrapping row were already on the first (19 and 150 px of extra padding). Each item reaches
  where the browser drew it (its `wh`) or its layer, whichever is larger; overlapping items or items
  on a line where they do not fit give no padding.
- **A wrapping row with `space-between` and one item per line aligns to the start**: Figma's
  `space-between` has no minimum gap and would put the items back on one line (a 176 px title and a
  151 px meta fit in 330 without the 16 px gap). It is read from the sizes (the box measures exactly
  its stacked items plus the row gap), not from the positions. In the instance, the alignment travels
  as an override and `carrySize` lets it hug its two-line height.
- **An `auto` track hugs its content only if that reproduces the drawn size; otherwise it shares
  the space**: fixed in px, a field whose value takes two lines never grows in its instance; but the
  browser stretches the `auto` tracks of an axis without `fr` over its box's own space
  (`align-content: normal`: a 34 px header centers its 26 px of content, a label stretched to its
  54 px row centers its two lines) and a cell that fills its track has no content length (the toolbar
  inflated to 100 px). `applyDeclared` measures the grid hugging with those tracks; if it does not
  give the drawn size, the tracks become `FLEX` and the axis stays fixed.
- **The cell that filled a track that becomes hug keeps its length**: it hugs if it can, or stays
  fixed at the drawn size, and the same for what filled that axis inside it, all measured before the
  change (a 9 px status dot inside a margin ended up at 1 px).
- **Padding, alignment and tracks also travel inside nested instances** (`copyLayout`, shared by
  `copyShallow` and `copyOverrides`): the header nested in a section takes from its page the start
  alignment that lets it wrap.
- **A cell does not fill a column that hugs its content** (`inferSizing`): it would close with it.
- **The boxes around a text that wraps on some screen grow with it** (`wrapTexts`): each box
  upwards whose height is its content's becomes hug (the box of a bar's label kept the row on one
  line where the browser drew two).
- **A grid's fixed tracks travel as overrides**: an instance can override
  `gridColumnSizes`/`gridRowSizes`, so a 330 px label column on one screen and 240 on another (a CSS
  variable, not another structure) takes its page's value. Tracks that grow or hug stay the main's.
- **The swap picks the variant with the same declared columns** (`gc`) as the occurrence, on every
  path (`chromeFits` too, not only `fitsRoot`/`sameKids`): the builder already groups by them. A
  330 px label row that fell into the 240 px variant inherited its fixed 54 px label (a nested
  instance swapped to another main cannot be resized) in a 47 px row.
- **The CSS minimum width goes into the main** (`minWidthsOf` in `lib/dom-map.mjs` → `minW` of
  `build-level`): a slot text whose box has the same width in several occurrences with different
  texts has its own `min-width` (`.section-meta { min-width: 20ch }` = 151.4 px). Without it, Figma
  shrinks the text to the gap left and keeps on one line the header the browser split in two (−19 px
  on everything below). It goes into the main before measuring, because an instance cannot override
  a minimum width; the text is found by its slot tag or by its position in the page (`path`), only if
  it is a text.
- **Binding a main to a variable erases its instances' overrides** (padding, gap, radius, border):
  `05y-tokenize` first reads each instance's own values (`getInstancesAsync`; the instance's layer for
  the main's layer `d` is `I<instance>;<d>`) and restores them afterwards, bound to the variable of
  their value if it exists. Without it, a section with gap 14 on its screen went back to the main's 10
  and a list of three fields with gap 14 went back to 16 and broke into two rows. The pilot did not
  show it because it does not tokenize: geometry is audited **after** `05y`. The read only runs when
  that main is going to bind something (a rerun over mains already bound does not walk their
  instances).
- **A main does not stretch inside its card** (`05z-organize`): a main made from a node that filled
  its row on the screen keeps `layoutAlign: STRETCH`; put into the vertical card it took the card's
  width (844 px) and with it every fixed-width instance that follows the main (the 8 px panel divider
  measured 844 on 31 screens). Organize stores the size, removes the stretch and restores it; audit A1
  checks it ("no main stretched by its card").
- **Each optional part has its own switch**, even when two share a name (`ToolButton`,
  `ToolButton 2`): with a shared one, the chat header showed both its buttons on the screen that only
  draws the close one.
- **A wrapping row that centers its lines has no padding on the left** (`read-tags`): the first box
  of each line starts where the centering leaves it; reading that gap as padding shifted the chat
  suggestions 8 px.
- **A nested instance with fewer parts than its main hides the missing ones** (`copyOverrides`):
  the side panel brings the chat header with "New chat" and two buttons; in the empty chat the browser
  only draws the two buttons. With child lists of different lengths nothing was copied and the button
  was left over on three screens. Now it matches by tag or name, in order, and hides what is left
  over (only if every part matched). Audit A2 marks it as `diff` (instances/browser).
- **Inside an icon only the shapes take the color** (`copyOverrides`): the svg box also carries
  `currentColor`, and copied onto the wrapper frame it painted a black square behind the chevron
  ("Filters ■"). The geometric audit does not see it: the visual review does.
- **A clipped multi-line text box is a line-clamp**: the main froze it at its occurrence's lines
  (a two-line title, 37.8 px) and in the instances with a short title the meta fell under the row's
  edge. `build-level` leaves it hugging with a `maxHeight` of those lines and the text with `maxLines`
  and a "…" ending. If the main changes when instances already exist, Figma leaves the old height in
  them: fix it by switching the box to FIXED and back to HUG.
- **A positioned layer goes back to the box that holds its center and almost all its area**
  (≥85 %): a 26 px mark hangs 2 px under the track that positions it; a line that crosses every row
  has no single owner and stays.
- **An optional part inside a one-row (or one-column) grid takes the grid out to auto layout**
  (`flowOptional`, in the kit, when the booleans are created). A hidden cell keeps its track and its
  gap, and an `auto` track left empty even takes part of the leftover: the side panel header
  (`1fr auto auto`, with the second button off) left the title at 268 px of 546 and the X 278 px from
  the edge. In auto layout what is hidden takes no space. The grid's **live** tracks are respected:
  `fr` → `FILL`, px → fixed, `auto` → the cell's own size (a 32 px avatar does not hug its initials).
  What has the part in a flexible track stays a grid (a table's columns must stay aligned across
  rows), and so does what has `fr` tracks of different weights (`2.5fr 92px 1fr` has no auto layout
  equivalent). Do not use `unGrid` for this: it reads the `auto` tracks without `fr` as proportional
  weights and on the first attempt it left five components with their parts spread in equal shares (a
  109 px search icon).
- **`auto` rows the capture drew together at the top stay `HUG`** (`applyDeclared`, `packed`): a
  frame stretched to its row's height (the "Add" card next to a person with a role) has leftover
  space; if with `HUG` tracks each cell stays where the browser drew it, the leftover goes to the end
  (`align-content: start`) and the rows are not spread. Before, "Add" sat 7 px below the names.
- **The box of a text with a text property hugs the text it shows** when it measured exactly its
  text and the property's default value changed its number of lines: a bar's label kept the 37 px of
  two lines with one line on top, outside the row.
- **A slot in a grid with `auto` rows (`gr:*h`, or `h` in the code) fills its cells with `HUG`, not
  `FILL`** (`gridSlot`): with `align-content: start` the cells shared the slot in equal parts and the
  team cards pushed their members down 83 px.
- **`build-icons` does not copy the svg box's fill onto the instance box**: the icon box stayed
  painted and each chevron was a solid square. Only the shapes take color.
- **A slot's text is read only from what is visible** (`capture-batch`, `txt()`): a name with a
  hidden short version (`<i>`/`<b>`) arrived doubled ("SamSam"). In instances already made, the name
  is a text property of the component: fix it with `setProperties`, not by writing `characters`.
- **A manual repair never fixes at its current height a frame without auto layout that was in
  `FILL`**: that height is the wrong share (the header of an "Also" card stayed at 93 px and its
  "Add" button fell outside the card). Fix it at the reach of its content.
- **A one-sided border travels with its sides** (`copyShallow`): the row that in the CSS carries
  `border-top` (`.row + .row`) copied only the paint and took the main's uniform weight, so each row
  ended up boxed (102 instances in four components). `strokeTop/Right/Bottom/LeftWeight` and
  `strokeAlign` are copied.
- **A rotated icon goes where its box is, not its origin** (`build-icons`): the capture brings the
  rotated svg (an arrow pointing right) with `x/y` at its origin corner, which the rotation moves to
  another corner. The instance, upright and with the rotation inside its main, was shifted by its own
  size: the back arrow 18 px above the text and a field's "›" 10 px below its row (152 on screens). It
  is placed with `absoluteBoundingBox` relative to the parent.

## Prototype and pages

- **The scroll direction lives in the main.** Figma does not let you change `overflowDirection` on
  a layer inside an instance (it throws "cannot be overridden in an instance"), not even on an
  instance placed inside another main. A scrolling box inside a component (the collections canvas
  inside `ContentCanvas`) stayed clipped but without scroll when presenting. `swap-level` walks at
  the end the `[[scroll]]` boxes of each screen and sets the direction (and the clipping) on the main
  they come from, merged with the one it already had; where the content fits nothing moves.
- **The link does not travel in the component**: the prototype is wired at the end, from
  `links.json`.
- **A scroll step is also a link**: `SCROLL(sel)` is wired on the box that scrolls.
- **A component is recognized by its `uic.component` mark**, and **the dark copy by `darkOf`**,
  never by name.
- **A font token changes everything**: `--font-*` triggers the full rebuild.
- **SF Pro and the `wdth` axis**: Figma rejects that axis when copying the font; it counts as a
  warning.
- **Documentation colors are not theme tokens**: on `#bdbdbd` the theme's `muted` does not reach
  AA. Headings use fixed inks.
- **An update that touches screens regenerates the flows page and the cover** (`13-flowmap-*`,
  `14-cover` in `next/gen`): the flows page clones the screens, so without regenerating it, it showed
  the old ones. The dark copies are located at run time by `uic.darkOf`.
