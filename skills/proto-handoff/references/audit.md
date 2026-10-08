# The audit: the skill checks its own work

Read this before step 5 and before handing any build or update to the user.

```sh
node scripts/audit.mjs prepare <dir> <maps-dir> gen/audit     # A1-components, A2-screens-*, A3-pages, A4-geometry-*
# run gen/audit/*.js with use_figma; save each result to gen/audit/results/<script>.json
node scripts/audit.mjs report <dir> gen/audit                  # OK/FAIL table; exits with 1 if anything fails
```

The thresholds come from the config (`audit.*`, copied into `state.options.audit`); defaults in
parentheses. Checks for outputs turned off in the config (`outputs.*`) are skipped.

| Check | What it requires |
|---|---|
| Inventory | Each adapter component exists once, on its stage's board; none is left over; no "(previous)" |
| Lists | Every list keeps its rows in a slot |
| Screens | Per screen, each component the browser drew is an instance (census = instances; what is merged or blank is accepted without being required); no tagged copy left loose; no "· unchanged" |
| Scroll | Every scrolling box is clipped and has a scroll direction |
| Dark | Each screen has its dark copy (only with `outputs.darkScreens`) |
| Pages | Cover, Components, Foundations and Screens: background `style.pageBg`, sections `style.sectionFill`, one row aligned to the top, in order; User flows: a column. AA text on the sections |
| Flows | Each screen copy in the flow map (`uic.flowCopy`) has as many vectors and instances as its screen: a copy made before a rebuild shows instances of components that no longer exist (empty icons) |
| Geometry (`A4`) | Each component the browser drew is matched **by order** with its instance and measured (± `audit.tolerancePx` (2) px; browser boxes at 0.1 px; the browser's scrollbar width is tolerated): at least `audit.minScreenPct` (90) % in place on each screen, and no component shifted on `audit.systematicScreens` (3) screens or more. A systematic defect comes out as one line (`AppHeader dh −8 on 83 screens`), not 83 complaints. A box the browser merges with its parent (`merged`) is optional: it counts only if Figma has that instance (without that, one merged row shifted the whole matching by a row). **Capture drift**: Figma puts each text line on whole pixels (an 18.125 px line measures 19), so the capture draws the page a bit longer than the browser and the rounding accumulates downwards (+2 to +4 px halfway down the page). `read-tags` stores the capture's boxes before touching anything (`uic.capGeo` on the frame); an instance that is where the capture drew it (±2 px), when the capture landed within ≤3 px (x, width) and ≤6 px (y, height) of the browser, counts as `drift`; the capture box is the closest one it drew for that component, not the one with the same order (the capture stores the sticky header at the end of the list). The report gives `pct` (strict against the browser) and `pctAdj` (with drift) and requires the minimum on `pctAdj`. What the capture drew further away (a baked margin, a gutter) must match the browser |

## Rules

- **The cycle does not end with open failures**: fix the cause (in the template, not by hand in the
  file) and audit again. Give the user the report table as it came out.
- **Before auditing**, delete the temporary pages (specimens, pilots) and duplicate captures.
- **An update is delivered only with the audit of the screens it touched** (A2, A4 and Flows on
  those screens) **and a visual review**: screenshots (`get_screenshot`) of the 5 screens with the
  lowest `pctAdj` and of the ones that changed structure, compared with the prototype. Geometry does
  not see paint (a chevron turned into a square), per-side borders or rotations; the visual review
  does. An update was once delivered with one screen at 79 % and the flows page not regenerated, and
  the person found it before the audit did.
- `scripts/audit-visual.py` (optional, needs Python with Pillow and numpy) writes a per-screen
  pixel diff image from pairs of browser and Figma screenshots, for when a reviewer needs to see
  *where* two renders differ.
- **Promotion gate**: `node scripts/update.mjs promote <dir>` refuses to promote an update whose
  last audit report failed, unless the user explicitly accepts the open failures (`--force`).
