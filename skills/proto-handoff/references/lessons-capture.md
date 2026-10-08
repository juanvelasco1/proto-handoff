# Lessons from real runs: capture

Read this before capturing (step 2.2 and updates) and whenever a capture is late, stuck, doubled
or comes out with wrong layers. Each rule came from a real failure; the templates already apply
them — this file explains why, so nobody "simplifies" them away.

- **Captures are matched by `[[screen:id]]`**, never by order or position: they land at page level
  and sometimes in another order. The local log is a help; the table from `figma/find-captures.js`
  rules.
- **A capture still `processing` can land late.** It is retried once with another id, and the
  duplicate that lands afterwards is deleted when reconciling. The heaviest screens (3,700 nodes, a
  126 KB map) get stuck when four agents run at once: they go alone, one at a time, with 80 polls.
- **A tall table with photos never finishes converting** (a sheet of 185 rows with two images each:
  13,800 nodes). `capture-run --trim ".table.tall .table-row:12"` keeps 12 rows per tall table and
  leaves the others alone; the map comes from the same trimmed page. Report it to the user as an
  assumption.
- **The `[screen:id]` tag sits among the other tags** of the same element: `find-captures.js` looks
  for it inside the block, not as the whole block.
- **A `position: sticky` element comes twice**: a "Sticky placeholder" (or "Placeholder for") that
  holds its place in the flow, and the real element, absolute, on top. On a still screen the element
  takes the placeholder's place (the innermost one; an outer one is its margin). Without that, the
  product photo and the timeline header row came out doubled. A sticky that comes without a
  placeholder (`[[pos:s]]` absolute over its siblings) goes back inside the tagged sibling that
  contains it (`rehomed`), in its order by position.
- **The capture bakes padding into the element**: the layer measures more than the `wh` box and the
  component would carry the margins of its spot. The difference moves to a `margin` frame outside
  (`baked`) and the element measures what it measured in the browser.
- **The served HTML carries the runtime embedded**: after touching `runtime/contract-runtime.js`,
  embed it again in the copy the server serves (`node scripts/embed-runtime.mjs <served figma.html>`)
  and check it (`grep flexCode figma.html`). Three agents captured 30 screens with the old tags by
  skipping it.
- **The latest capture of a screen wins** (`capture-record.mjs`): keeping the first record left
  every recapture out of `nodes.json`. And among maps, the most recent by file date, not the one from
  the batch with the highest name.
- **A 3,700-node screen never finishes converting**: `capture-batch --trim <selector>:<n>` keeps
  `n` children per parent before capturing (a bill-of-materials table went in with 120 rows). Report
  it as an assumption.
- **The capture merges an element with the same box as its parent when it is the only child**
  (`RecordHeader` inside `ItemHeader`): one layer remains, with the parent's name.
  `lib/dom-map.mjs` marks it `merged`; the census does not require it and lists by order do not
  count it. A box that paints nothing (`blank`) may or may not come: the census accepts it without
  requiring it.
- **Capture ids expire** (410 `CAPTURE_EXPIRED`): request them per batch, right before the batch.
- **Inventory selectors are verified in the browser**: `.app-header` was the name of a section; the
  real class was `.topbar` (id `#topbar`). `.user-row` was an id.
- **A piece painted after load** (the chat reply) is awaited with a step that returns a promise;
  without it, the next render erased it before the capture.
- **If capture conversion gets stuck for one file** (everything stays `processing` even after
  reloading Figma, while a new file converts instantly), capture into an **auxiliary file** with the
  variable collections copied (same names and WEB `codeSyntax`, so the capture comes out bound). The
  user copies those frames and pastes them on the cover page of the main file, and a script re-binds
  each variable by name to the main file's variables and deletes the collections the paste brought.
  Then: `find-captures` on the cover, combined maps under the main file's names and
  `sync.mjs … --late <screens>`. At the end, ask the user to delete the auxiliary file.
- **A page stays open until its upload finishes** (`capture-batch`): closing it after 30 s cut the
  upload and the capture stayed `processing` forever. Even so, what Figma finishes late is
  reconciled with `find-captures.js`: polling said `processing` for captures that were already on
  the page.
- **Horizontal scroll is captured at 0** (`__uiResetScroll`, before the map and the capture): a
  timeline scrolled to today left the fixed labels 2,100 px to the left. Only the x axis: a chat at
  the end of its conversation stays where it is.
- **The reserved scrollbar counts even without overflow** (`gut:`): with
  `scrollbar-gutter: stable` the browser sets 10 px aside and the capture does not; everything inside
  came out 10 px wider. **`align-self` travels as a tag** (`as:`): a centered day separator moved
  left at the first re-layout. For captures made before those tags existed, measure the runtime
  effects in the browser (a small Playwright pass over the served page that reads each tagged box's
  gutter and `align-self`) and pass them to `02-tags` (`addTags`, by tag and size); they never
  overwrite the tags the layer already has.
