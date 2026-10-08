# Builder rules: variants, slots and stretching

Read this before step 2 (the `L<k>-build` / `L<k>-swap` scripts) and before touching
`scripts/figma/build-level.js`, `swap-level.js` or `scripts/lib/figma-kit.js`. These rules are
implemented in the templates; this file explains them so a fix goes into the template, not into
the file by hand.

## What a variant is

- **A variant is a value of props × a structure. Never a width or a position.** Occurrences are
  grouped by props; inside a group, an occurrence that has the same parts as another minus some (a
  row without a counter) joins the more complete one. Result: a table that measures 1,142 px on one
  screen and 454 on another is **one** variant.
- **The shape of a grid does count in a container** (`gridSig`): two occurrences with a different
  number of columns (or of rows, when the cells do not match) are different variants. A 3-column
  header and a 2-column one do not share a main: on swap, the 2-column one lost a track. The main
  keeps the shape its grids had in the capture (`gsig`, when it is cloned): measured live after the
  slot was filled, a main with 10 timeline rows read `g1x10` and every screen with another number of
  rows became a new variant (8 extra in the pilot).
- **In a list, what counts is not how many rows it has but how they run** (`runFits`): in a column,
  in a line or wrapping. A slot that wraps accepts any of them.
- **Optional parts → boolean properties.** What some occurrences lack stays in the main bound to a
  boolean; each instance turns it off where it does not belong.
- **Adapter texts → text properties**, bound only to the main's own layers (never to a text inside
  a nested instance).
- **Rows whose cells change → one slot per cell** (`Cell 1`, `Cell 2`…): when a row would give more
  than 3 structures because each cell brings something else, the row chrome is one and each cell is
  a slot. `ProductRow` went from 33 variants to 1.

## Slots

- **Lists with a `Rows` slot.** The main carries header and footer and shows 5 rows; each instance
  brings its real rows (instances of the row component, with their overrides). Editing the table
  edits every table; editing the row edits every row.
- **Containers with a `Content` slot.** The content of all occurrences is compared: what is the same
  in all of them (the rail header, the footer with the role) stays in the component; what changes
  goes to the slot. A container that appears **only once** carries all its content in the slot:
  without another occurrence there is no way to know what is fixed.
- **To decide what is fixed, what counts is which component each part is** and, if the part holds a
  slot, which instance it is: two different lists of the same component are not "the same part".
- **A slot inside a container's grid takes the cells of its span and the grid stays**
  (`gridSlot`). Only in containers: the rows of a list leave the grid (a column of rows is a stack;
  equal cards wrap). With the grid kept, the main of a long product table held the capture's 92 row
  tracks around its 5 rows and measured 4,090 px. Container example: the header is
  `1fr | 360px | 1fr`; the slot spans the first two tracks and holds the left block + a search box
  on one screen and the left block + a spacer on another, and the search box stays centered.
  Turning the grid into auto layout with the slot `FILL` next to the right group `FILL` split them
  50/50 (the search box ended up 186 px to the left). **The cells leave the grid before the slot
  goes in**: with the cells still placed, the slot did not fit its span, stayed `null`, and the
  header and toolbar were left without a slot (frozen). If it still fails, the cells go back, the
  slot is removed and the grid is trimmed.
- **A grid of equal cards over several rows becomes a wrapping row** (`WRAP`) with the card's fixed
  width and the **measured** gaps between cells and between rows; its slot fills the width and hugs
  the height (a slot that hugged the width did not wrap: a single row). Each card's width goes one
  tenth below (`wrapWidth`): three cards of 144.7 plus two gaps of 14 measure 462.1 in a 462 row and
  the third wrapped. When the slot is filled, each card keeps a fixed width and the sizing type its
  cell had (`kinds` of the slot). Any other grid of several rows and columns cannot be a slot nor be
  cut out of a frame without auto layout: those lists are made by identical structure (a grid of 4
  fields is not a grid of 8 with 4 hidden: hidden cells keep their track).
- **When a slot is filled** every size is measured before anything moves; a row that grew to share
  a fixed height keeps its height (in a hugging slot, that `FILL` squashed them); a slot with
  nothing to hold is hidden.

## How things stretch (deduced from the page)

- A grid's tracks are **those of the stylesheet** (`gc`/`gr` of the capture): `fr` flexible, `auto`
  fits content, px fixed; if no axis has `fr`, the `auto` tracks share the leftover like in the
  browser (the only row of a 34 px header measures 34). Without that tag, a column that changes width
  between occurrences becomes flexible. When a one-row or one-column grid is turned into auto
  layout, the frame **keeps its size** (changing the layout mode made it hug its content), its
  flexible tracks become `FILL` children, `auto` ones `HUG`, and the cells keep their alignment.
- A child as wide as its container (**with 2.5 px of tolerance**, because of 1 px borders) fills it
  (`FILL`, like a CSS block); a grid cell fills its track. **Never along an axis the parent hugs**:
  with 4 px, a 24 px tool "filled" the 28 px row that hugged it, the row hugged the tool, and both
  collapsed to 1 px.
- **An instance ends up the size the page drew**: the sizing mode the raw layer brings (a `HUG`
  that shrank a 26 px button to its 21 px of text) gives way to a fixed size; what fills its parent
  stays with the parent.
- **A frame only hugs its content if the page did** (`hugPlan`): a 34 px header with 26 px of
  content, a scrolling box or a grid keep their height and nothing above hugs; a list does (a main
  with 5 rows measures 5 rows). Wrapping rows too.
- A grid row that changes height hugs its content, and whatever stretched inside it hugs too
  (otherwise the row and the card wait for each other and collapse).
- **Nothing fills an axis its parent hugs** (`settle`): it is resolved from the inside out, or the
  child collapses or opens a gap. This also applies to grid tracks (`applyDeclared`): an `fr` row in a
  grid whose height hugs becomes px (unless the stylesheet declares it `fr`), and on the axis that
  does have a flexible track the frame stops hugging; a single column stays flexible.
- **Tracks left after the last cell are trimmed** (`trimGrid`): leftovers of an `auto-fill`, the
  ghost row a misplaced cell opens. Without it, an empty `auto` row hugged nothing and the main of
  `AppHeader` measured 16,902 px.
- In a frame without auto layout, only what the browser pushed right with a gap of more than 24 px
  is anchored right (anchoring too much cut the breadcrumbs).
- A one-line text hugs its width; a multi-line text, its height.
- **Scroll**: the box keeps its visible height and is clipped; the rest of the chain upwards hugs
  its content. A box with horizontal scroll (a wide table in a narrow panel) leaves the rows at their
  width.
- **A main inside its set keeps its size**: the capture brings `FILL`/`grow` from the screen, and
  inside the set's auto layout that collapses it to 1 px. It is fixed to the measured size before
  combining.
