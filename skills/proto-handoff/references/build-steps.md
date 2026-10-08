# Build steps: what each generated Figma script does

Read this before running the scripts of step 2 (initial build) or of an update. `sync.mjs figma`
generates them into `gen/` (or `next/gen/`, `next/gen-late/`) and prints the exact order to run.
Run them with the runner runbook (`agents/runner.md`).

An output turned off in the config (`outputs.*`) is skipped: its scripts are not generated and its
audit checks do not run.

| Script | What it does |
|---|---|
| `00-install-check` | Says which installs are redundant (the file already stores those templates with the same hash): the runner does not run them. An update almost never changes templates, and each install is ~20 KB that the runner takes minutes to emit |
| `00-install-*` | Installs the templates in the file. The code travels as `String.raw` (not as JSON text: the runner re-emits each install, and a doubled backslash got lost on the way — `/^Icon\//` arrived as `/^Icon//` and `build-level` stopped compiling) and is verified in the file by length and FNV sum before it is stored: an altered copy is refused and sent again. `00-install-check` also compares the stored code, not just its hash label |
| `00-clear-components` | Empties Components except the icons (full build only). With `--park`, when some screens are still waiting for their capture, the old components move to a temporary page flagged `uic.old` (build and replace ignore them; the capture runbook calls this step `04-park-components`): those screens keep rendering and come in later through the late path (replace, swap-only levels, build what is missing); at the end the page is deleted |
| `01-replace` | Puts each capture INSIDE its screen's frame: the frame keeps its id and every link that points at it |
| `02-tags` | Tags → clean names + `uic` data; clips `[[scroll]]` boxes, turns on their scroll and turns the scrollbar gap into padding; a sticky element goes back to its place; padding the capture baked into the element moves to a `margin` frame; `[[fx]]` boxes become auto layout (wrap, space between). Reports `rehomed`, `baked`, `gutters`, `flexed` per screen: zero everywhere is the sign of a capture made with an old runtime |
| `02b-text` | Right- or center-aligned texts get back the box they had in the browser (`fix-text-boxes.js`): the capture makes them as wide as their glyphs and shifts them left |
| `03-icons` | Each glyph becomes an instance of `Icon/<name>`; existing icons are reused |
| `00-variables` | New or changed tokens as variables (updated by name; ids are kept) |
| `01a-remove` | Deletes the frames (light and dark) of screens the flows no longer have |
| `L<k>-build-*` | **Per-level builder** (`build-level.js`): sees ALL occurrences of level `k` on all screens and makes the components (rules in `builder-rules.md`): up to 10 per call at levels 0 and 1, **one per call from level 2 on** (a whole level in one call cut the transport). A result with `_pending` is run again. It only reads the screens |
| `L<k>-swap-*` | Replaces each occurrence of the level with an instance, in batches of screens (`swap-level.js`). What fits no variant becomes a new variant (never a loose copy) |
| `04-patch-*` | In-place adjustments of screens that are not recaptured |
| `04s-*` | The specimen sheet (`--specimens <nodes.json> <maps>`) goes through the same levels and then its frames are deleted |
| `05y-tokenize` | Binds loose values of the mains: text → style, radius → `radius/*`, padding and gap → `space/*`, stroke weight → `border/*`. Reports colors without a variable |
| `05z-organize` | Components page in house style (`house-style.md`): one board per stage, one card per component with type, variants, uses, anatomy, specs and tokens |
| `06-verify-slots` | 4 screens per call (10 went over the `use_figma` limit). Compares each text of each instance with the browser's and fixes what differs. Matches **by order** within each component (row k in the browser with instance k); matching by proximity wrote one row's text into its neighbor when the layout shifted a few pixels |
| `07-wire` | Prototype connections from `links.json` and each element's box; flow starting points |
| `08-dark` | A clone of each screen with the Tokens collection set to Dark, without connections |
| `09-foundations` | If tokens changed: the Color board of Foundations again, in place |
| `09-layout-screens` | Screens page in house style: one section per app, each screen with its dark copy below, names like `F4·3 · Title` |
| `10-validate-links` | Read-only: each link exists once, on its element; no dark copy has connections |
| `13-flowmap-*`, `14-cover` | (Updates) the flows page and the cover again, because the flows page clones the screens |
| `99-drop-park` | (Late path) deletes the parked components page when no instance outside it uses them; if some do, it keeps the page and says which |
| `audit/A*` | **Audit** (read-only). See `audit.md` |

## Levels

The levels come from the DOM maps (`scripts/lib/levels.mjs`): a component's level is 1 plus the
highest level of **any component it contains on any screen**: `Avatar` (0) → `InboxRow` (1) →
`InboxList` (2) → `InboxPanel` (3) → `ContentCanvas` (5). Each level runs after the previous one, so
a host always finds its parts already turned into instances. (Measuring the height of each subtree
separately does not work: a card that on one screen only holds flat chips landed on the chip's
level, was swapped before it, and its chips stayed loose inside the main.)

## Dark copies

After `08-dark`, the ids of the dark copies go into `state.json` (`screens.*.dark`): the flow map
clones them.
