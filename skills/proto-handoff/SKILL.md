---
name: proto-handoff
description: Turns an HTML prototype made with an AI builder (Open Design or any single-file HTML) into a truly editable design file for Figma — variables with light and dark modes, every repeated piece as a component (atoms, rows, tables, lists and containers such as sidebars, headers and panels) with variants, slots and properties, icons as components, screens built from instances, a clickable prototype, a flow map and an audit that proves the file is right — and keeps that file up to date when the prototype changes, touching only what changed and never overwriting hand edits without asking. Use it when someone asks to move a prototype or an HTML file into Figma as real, componentized design, with a design system or connected flows, or says the prototype changed and the Figma file needs updating. Not for a screenshot-only screen map. Independent project, not affiliated with Figma.
license: MIT
compatibility: Needs code execution and file access, Node.js 18+, Chrome or Chromium, and Figma's remote MCP server with the use_figma and generate_figma_design tools (writing needs a Figma Full seat). Without the Figma tools it runs in analysis-only mode.
---

# proto-handoff

Turns an HTML prototype into a Figma file a designer can edit: the screens are real layers bound to
variables, **everything that repeats is a component** (containers too: sidebar, header, panels,
sections), tables and lists keep their rows in a slot, icons are components, the prototype
navigates and the flow map reads on its own. When the prototype changes, **what changed is updated,
nothing is rebuilt from scratch**. At the end of every cycle an **audit** says, with evidence,
whether the file passes.

- **Talk to the user in their language** (config `language`: `"auto"` follows the user). Text
  written inside Figma follows `docsLanguage`.
- Paths below are relative to this skill's folder (the folder that holds this `SKILL.md`).
- The heavy lifting is done by `scripts/`. Those in `scripts/figma/` are templates for `use_figma`;
  the rest run in the terminal with Node. The runbooks for delegated work are in `agents/`.
- **Figma tools**: this skill names the Figma MCP tools by their base name (`use_figma`,
  `generate_figma_design`, `get_screenshot`); in your client the full name carries a prefix (in
  Claude Code, for example, `mcp__plugin_figma_figma__use_figma`). If your client ships Figma's
  `figma-use` skill, load it before the first `use_figma` call.
- **Subagents are optional**: if your tool supports them (and config `agent.subagents` is not
  `"never"`), run the runbooks in `agents/` in one; otherwise follow them yourself, one step at a
  time.

## Where to read what

| Before… | Read |
|---|---|
| Step 1 (inventory), or when layer names come out wrong | `references/contract.md` |
| Running the build scripts | `references/build-steps.md`, `references/builder-rules.md` |
| Any `use_figma` run | `references/lessons-execution.md` |
| Capturing | `agents/capture.md`, `references/lessons-capture.md` |
| Touching a template, or when a component/instance comes out wrong | `references/lessons-components.md` |
| Documentation pages (Cover, Components, Foundations, Screens, User flows) | `references/house-style.md` |
| Step 5 and any hand-off | `references/audit.md` |
| Creating a project, or when the work folder is damaged | `references/state-json.md` |

## Step 0 — Preflight and configuration

Run this at the start of every session, before touching anything.

1. **Doctor**: `node scripts/doctor.mjs`. It checks Node ≥ 18, that the npm dependencies are
   installed (`cd scripts && npm install` once), that Chrome/Chromium is found (`CHROME` env var or
   config `browser.chromePath`), that the config is valid, that the server port is free and that the
   work root is writable, and prints which mode is possible.
2. **Figma tools**: check your own tool list for `use_figma` and `generate_figma_design` from
   Figma's MCP server.
3. **Pick the mode and tell the user** what it can and cannot do:

| Mode | When | What it does |
|---|---|---|
| Full | Doctor passes and both Figma tools are there (Full seat on the file) | Everything in this skill |
| Variables only | `use_figma` is there but `generate_figma_design` is not | Variables and (once screens exist) boards; no screen can be captured. Say so and offer analysis-only for the rest |
| Analysis-only | Doctor passes but no Figma tools, or no Full seat | Tokens, inventory and adapter, migration, reference screenshots, the flow table, the update report. **Nothing is written to Figma.** Say exactly that |
| Blocked | No code execution, no file access, no Node or no Chrome | Stop. Explain what is missing and how to get it; do not improvise a partial run |

### Configuration

- **User config**: `~/.proto-handoff/config.jsonc` (the env var `PROTO_HANDOFF_CONFIG` points elsewhere).
  `node scripts/setup.mjs` creates it from `config.example.jsonc` (it never overwrites an existing
  one); each field is documented there. Without the file, the defaults apply.
- **It is validated at start** (by `doctor.mjs` and by every script that reads it). An invalid
  value **stops the run** with a clear message: show it to the user and ask them to fix the file.
  Never proceed half-configured.

| Configurable (preferences) | Fixed (mechanics — never change these from config or on request) |
|---|---|
| `language` (`"auto"` or a language code) · `docsLanguage` (`en`/`es`, text written into Figma) | The `data-ui` contract and the capture tags |
| `workRoot` (default `~/.proto-handoff/projects`) · `server.port` (8777) | The order of the scripts and the levels |
| `viewport` (1440×900; mobile 390×844) | Idempotency of every template; the audit loop |
| `pageNames` (cover, foundations, components, screens, flows) | The `state.json` schema |
| `outputs` (cover, foundations, flowMap, darkScreens, prototypeLinks) | Mode names `Light`/`Dark` |
| `style` (pageBg, sectionFill, title, subtle, gap) | Slot names `Rows`, `Content`, `Cell N` |
| `audit` (tolerancePx 2, minScreenPct 90, systematicScreens 3) · `browser.chromePath` · `agent.subagents` (`"auto"`/`"never"`) | |

### New project

- `node scripts/init-project.mjs <project-name> <prototype.html>` creates
  `<workRoot>/<project-name>/` with `orig.html` and a `state.json` skeleton from the config. The
  work folder lives there **from the first step** — never inside the user's project, never in
  `/tmp` or a session scratchpad (see `references/state-json.md`).
- **Figma file**: a design file (a `/design/` URL) the user gives you; store it with
  `node scripts/init-project.mjs set-file <dir> <figma-file-url>` (its key goes to
  `state.fileKey`).
- **Pages**: `node scripts/init-project.mjs pages-script <dir>` writes `gen/00-pages.js`
  (finds or creates the five pages by their configured names); run it with `use_figma` and store the
  ids with `node scripts/init-project.mjs set-pages <dir> '<result json>'`.
- **Server**: `node scripts/serve.mjs <work-dir> [--port N]` serves the work folder's static
  assets on 127.0.0.1 only (port from `server.port`). The capture does not accept `file://`. If a
  capture fails with a CORS error, restart it with `--cors-any` and tell the user why.
- **Original**: **the user's HTML is never touched**. Work on the copy; the migrated version is
  `figma.html` (handed back with the `-figma.html` suffix).

## When something fails: report concretely and give options

An error that blocks or worsens the result is reported to the user **at that moment**, not at the
end or inside a summary. Never continue silently, never call something done with an open failure,
and never say "done" without the audit of what was touched.

Each notice carries:

| Part | What it says |
|---|---|
| What failed | The step or script, and the screen or component by name (not just its id) |
| Evidence | The error as it came out, the measurement (`pctAdj`, px of difference) or a screenshot |
| What it affects | What is left wrong or undone and how many screens or components it touches |
| Cause | The cause if known; if not, "I don't know it yet" and what will be checked |
| Options | 2 to 3 concrete ways out. Each says what the user has to do (if anything), how long it takes and what risk it carries. One is marked as recommended |

Always separate **"fixed in the template"** (the next build already comes out right) from **"fixed
by hand in this file"** (the next prototype would repeat the error). If a fix breaks something else,
say so just like the original error.

Examples of options:

| Failure | Options |
|---|---|
| Capture conversion gets stuck (a minimal page stays "processing") | Reload the file's tab in Figma and retry · capture into an auxiliary file and have the user paste the frames · build without those screens (`--park`) and add them later (`--late`) |
| A screen stays under the geometry minimum | Fix the cause in the template, rebuild and audit again · leave it as a residue with its cause and the px of difference, if it is not visible |
| A script fails in Figma | Fix the template, reinstall and repeat the step · skip that step if it does not block the next ones, leaving it on the pending list |
| A component appears on no screen | Build a specimen sheet and capture it · build it from its CSS (`synthetic`) · report it as missing |

## How the Figma scripts run

Templates are **installed in the file** once, and afterwards each call carries only its parameters
(`scripts/lib/fill.mjs`):

| Piece | What it does |
|---|---|
| `00-install-*` | Stores each template's code in the document (shared data `uicode`, with a hash per template). ~22 KB per call |
| `run(tpl, params)` | A few-line script that runs the installed template with those parameters. If the stored hash does not match, it **does not run** and warns: an old copy never runs |
| `chain.mjs` | Chains several steps into one call and stops at the first error. Each call must stay **under 45,000 characters** (`use_figma` cuts at 50,000): the steps that carry per-screen data (verify, wire, validate) go one at a time |

The runner runbook (`agents/runner.md`) reads each file, sends it as is, saves the result as one
line of `run.log` and stops at the first error. Rules:

- **The order is the step number**; the levels `L<k>` go between the icons and the adjustments.
  `sync.mjs` prints the exact order.
- **A cut script does not run**: if the call is interrupted or arrives truncated (syntax error),
  repeat it once.
- **A script that fails is rolled back entirely** in Figma: fix the cause in the template,
  reinstall and repeat it whole.
- **A call that moves to the background keeps running**: wait for its result before sending the
  next.
- The responses of `generate_figma_design` are long: captures also follow a runbook
  (`agents/capture.md`): **one agent, one capture in flight**, and the next is not sent until the
  previous one has landed. Figma converts a file's captures one at a time: with seven agents at once
  most stayed "processing", and sending without waiting lost 70 %.

## The contract

Every element the pipeline needs is declared in the HTML (`data-ui`, `data-ui-props`,
`data-ui-slot`, `data-ui-screen`, routes `#/<screen>?theme=`, a `ui-manifest`). A new prototype is
generated with the companion skill `proto-handoff-prototype`; an existing one is **migrated without
rewriting it** (`migrate.mjs` injects the adapter, the contract runtime and the route table). Before
each capture the runtime writes into each element's `aria-label` what it is (`[[ui:InboxRow|…]]`,
`[[screen:id]]`, `[[scroll:…]]`, `[[fx:…]]`…) and the capture turns it into the layer name. **Nothing
is matched by geometry.** Full tag table and details: `references/contract.md`.

## 1. Inventory: the single source

Before building, make the **complete inventory** of components and have the user approve it. The
adapter (`adapter.json`) comes from it, and the adapter is the only thing that decides what is a
component.

- **Where it comes from**: the functions that paint HTML in the prototype's JS (the designer's
  vocabulary), the CSS classes, and the DOM census of every screen (`capture-batch --no-capture`
  stores per node `ui`, `cls`, `scroll`, `ch` —background, border, radius, shadow—, `lay`, `ts` —the
  look of its text: size, weight, tracking, case, style, family— and, for right- or center-aligned
  texts, `ta`, `tx` and `pad`).
- **What goes in**: everything that repeats or has its own chrome. **If a component lives inside a
  container, the container is a component too** (sidebar, header, toolbar, canvas, panels, sections,
  cards). What only distributes space (no background, border or shadow) stays as auto layout inside
  the screen.
- **Each entry**: `{ ui, sel, kind, stage, props, slots, list }`.

| `kind` | What it is | How it is built |
|---|---|---|
| `atom` | Minimal piece (avatar, dot, divider) | Variants by props |
| `component` | Composite piece (row, button with icon, section header) | Variants by props and structure; optional parts as booleans |
| `list` | Table or list (`list`: the row component) | Header and footer in the component; **rows in the `Rows` slot** (the main shows 5) |
| `container` | Container (sidebar, panel, section) | What is the same on every screen stays in the component; **what changes goes to the `Content` slot** |

- **`stage`** groups the components into the boards of the Components page, in this order: App
  structure, Navigation, Actions, Forms and search, Tables and lists, Sections and cards, Charts and
  timelines, Status and feedback, Menus and overlays, Notices and detail, Chat, Identity; Icons last.
  Write the stage names in `docsLanguage`. Each table goes on the same board as its row.
- **Real selectors**: a layer name can come from a section or an id, not a class. Verify every
  selector in the browser; the census must give each component the same number of occurrences as
  the inventory.
- **What the code has and no screen shows** comes from a **specimen sheet**: extra routes that open
  a real screen and paint the piece with the markup of its own render function. They are captured
  as screens, go through the same levels (what exists is only swapped for instances; what is missing
  is built from there) and the temporary page is deleted afterwards. They are not added to Screens or
  to the flows.
- **What is on screen but not visible at rest** never reaches a capture either: actions that
  appear on hover (a parent with `opacity: 0`) or a transparent layer that closes menus
  (`position: fixed; inset: 0`, no paint). The browser dump (`capture-batch.mjs`) no longer records
  what hangs from an `opacity: 0` and marks `blank` the boxes that paint nothing, so the census does
  not expect them on screens. Their component is built from its CSS (size, radius, colors as
  variables, hover state as a variant, glyphs from the prototype's SVG) and carries
  `uic.synthetic = css` and a description saying why it does not come from a capture.

## 2. Initial build

```sh
node scripts/extract-tokens.mjs orig.html --out tokens.json
node scripts/gen-variables.mjs tokens.json > gen/variables.js      # → use_figma
node scripts/migrate.mjs orig.html adapter.json bands.json figma.html
node scripts/serve.mjs <work-dir>                                   # keep running during captures
node scripts/shoot-routes.mjs <url>/figma.html <screens> shots --themes light,dark
```

1. **Variables**: `gen/variables.js`. Two collections: *Primitives* (hidden) and *Tokens* (modes
   Light/Dark, each with `var(--x)` as code syntax).
2. **Tagged capture** (runbook `agents/capture.md`). **Captures upload the rendered prototype
   (texts, images, styles) to Figma's capture service and into the file**: before the first
   capture, tell the user, and ask if the prototype holds real or confidential data. Per screen,
   request a captureId (`generate_figma_design` with the `nodeId` of a section) right before —
   **they expire within minutes** —, run `capture-run.mjs` (about a minute; it saves the map of that
   same page load) and poll the id until it lands (about 45 s). If a minimal page does not land
   either, the file's conversion is stalled: stop sending, ask the user to reload the file in Figma
   and build with what landed. The capture appears at page level (often on Cover), not inside the
   section.
3. **Reconcile**: `figma/find-captures.js` (read-only) walks the page and matches each capture to
   its screen by `[[screen:id]]`. **That table rules**: a capture given up as lost can land late and
   leave two frames for one screen; keep the newest, delete the others, write `capture/nodes.json`
   from that table (`reconcile-captures.mjs`) and send again only what is missing.
4. **Figma scripts**, generated by `node scripts/sync.mjs figma <dir> <captures.json> --full`, in
   the order it prints: installs → clear components → replace → tags → text boxes → icons → levels
   (`L<k>-build`, `L<k>-swap`, inner components first) → patches/specimens → tokenize → organize →
   verify slots → wire → dark → foundations → layout screens → validate links → audit. What each one
   does, and the levels: `references/build-steps.md`. How variants, slots and stretching are
   decided: `references/builder-rules.md`. Outputs turned off in the config are not generated.
5. After `08-dark`, the ids of the dark copies go into `state.json` (`screens.*.dark`): the flow map
   clones them.

## 3. House style (every documentation page)

Pages Cover, Components, Foundations and Screens: gray page background, one `SECTION` per group,
all sections in one row aligned to the top; User flows in a column. Colors and gap come from
`style.*` in the config. Full rules, contrast and what goes on each page:
`references/house-style.md`.

## 4. Foundations, flows and cover

**Foundations**: one table per topic, taken from what the prototype really uses:

```sh
# text census (read-only): figma/census-type.js with { page: <screens> } → type-census.json
node scripts/gen-foundations.mjs <dir> gen/foundations --census <dir>/type-census.json
```

| Script | Topic | Creates in Figma |
|---|---|---|
| `F1-color` | Color by use, semantic colors, WCAG contrast per mode | — |
| `F2-type` | Family, h1–h6, scale with size, line height, weight and tracking | One text style per look with ≥ 20 uses |
| `F3-space` | 4-based scale, off-scale values, density and `size/*` measures | Variables `space/*` |
| `F4`–`F7` | Layout and grid, Iconography, Elevation, Borders and radii | Grid and effect styles, `border/*` |

A `NO` in the Foundations audit is a finding about the design system (a meaning without a soft
background, a text pair under AA): report it, never hide it.

**Flow map** (after the dark mode, with the dark ids already in `state.json`):

```sh
node scripts/gen-flowmap.mjs <dir>/map <dir>/state.json <flowsPageId> gen/flowmap \
  --groups <dir>/groups.json --compact <dir>/compact.json
```

Legend and index, one band per flow (light on top, dark below, arrows with the gesture), grouped by
app, and the compact map on the right. The screens are copies of their frames. **It is regenerated
every time the screens change**: an old copy shows incomplete screens.

**Cover**: `node scripts/gen-docs.mjs <dir>/map <dir>/state.json gen/docs` → `cover.figma.js`.

## 5. Audit: the skill checks itself

```sh
node scripts/audit.mjs prepare <dir> <maps-dir> gen/audit
# run gen/audit/*.js with use_figma; save each result to gen/audit/results/<script>.json
node scripts/audit.mjs report <dir> gen/audit        # OK/FAIL table; exits with 1 if anything fails
```

Checks: inventory, lists in slots, screens made of instances, scroll, dark copies, pages, flow
copies and geometry (thresholds from `audit.*`). Details: `references/audit.md`.

- **The cycle does not end with open failures**: fix the cause (in the template, not by hand in
  the file) and audit again. Give the user the report table as it came out.
- Before auditing, delete temporary pages (specimens, pilots) and duplicate captures.
- **An update is delivered only with the audit of the screens it touched and a visual review**
  (screenshots of the 5 screens with the lowest `pctAdj` and of those that changed structure,
  compared with the prototype).
- After the first full build passes, take the baseline fingerprints (update step 2 with
  `--as baseline`) so the next update can detect hand edits.

## Updating when the prototype changes

The everyday use: the user adjusts the design and asks to update Figma. **The file is never rebuilt
from scratch, and Figma is never written before the user has seen what will change.**

1. **Check (nothing touches Figma)**:
   `node scripts/update.mjs check <dir> <new-prototype.html>` runs the detection (`sync.mjs
   detect`), prints a human-readable report — screens new / modified / removed / unchanged with the
   action for each, tokens added / changed / removed, components touched and, if any, why the update
   has to be full — and writes `next/report.md` (`update.mjs report <dir>` shows it again). Show
   the report to the user as a table.
2. **Hand-edit check**: `node scripts/update.mjs fp-script <dir>` writes read-only scripts to
   `<dir>/fp/gen`; run them (runner runbook); then `node scripts/update.mjs fp-read <dir> --as
   current` and `node scripts/update.mjs conflicts <dir>`. It lists what was changed in Figma by hand
   since the last update and which of those edits the update would overwrite (**conflicts**). With
   no baseline yet it says so. For each conflict, ask the user: keep their edit (skip that screen or
   component) or overwrite it. **Never overwrite a designer's work silently.**
3. **Only after the user confirms**, apply:

```sh
# capture ONLY the screens in plan.recapture (agents/capture.md) and reconcile (find-captures.js)
node scripts/merge-maps.mjs <dir>/capture <dir>/next/<maps>     # maps from the same page loads as the capture
node scripts/sync.mjs figma <dir> <captures.json> [--specimens <nodes.json> <maps>]   # writes next/gen/*.js (and gen/audit)
# run next/gen in the order it prints; then the audit of the touched screens + visual review
# screens whose capture landed after the run (stalled conversion, build with --park):
node scripts/sync.mjs figma <dir> <captures.json> --late <screen,…> [--specimens …]   # next/gen-late/
# a patch that could not find its layers: node scripts/sync.mjs escalate <dir> <n,…>, then recapture
```

4. **Audit gate and promotion**: `node scripts/update.mjs promote <dir>` refuses when the last audit
   report failed (unless the user explicitly accepts the open failures: `--force`), backs up the
   local baseline to `<dir>/backups/<timestamp>/` and makes the new version the baseline. Then take
   the new baseline fingerprints: `fp-script`, run, `fp-read <dir> --as baseline`.
5. **Undo**: `node scripts/update.mjs rollback <dir> [<timestamp>]` restores the **local** baseline
   only (`update.mjs backups <dir>` lists them). Changes in Figma are undone with Figma's version history (File → Show version history);
   tell the user so.

**Every screen of the prototype goes into the file.** The list comes from the flows (`state.flows`,
the same file `migrate.mjs` builds the route table from): a new step in a flow is a `new` screen,
and a screen no flow has anymore goes away (`plan.removed`, its frames are deleted). When the design
adds a state (a new lane, a menu with a search box, a sheet that opens per collection), first write
its step into the right flow and test the recipe in the browser (`shoot-routes.mjs`). A recipe that
no longer reaches its state is fixed without changing the step title: the screen id comes from the
flow and the title, and so the frame keeps its id and its links.

| What is detected | What is done |
|---|---|
| A token changed, appeared or went away | The variable is updated; every screen inherits it |
| A font-family token changed (`--font-*`) | `plan.full`: every screen is recaptured and the components are rebuilt (frames keep their ids) |
| A screen looks different or its structure changed | **Only that one** is recaptured; its components go through the levels: what exists is reused and a new structure becomes a variant |
| Boxes that changed without painting anything new | In-place adjustment (`patch`); if it cannot find the layers, it moves to recapture (`sync.mjs escalate`) |
| Captures that landed late (`--late`) | The same steps as an update limited to those screens: what they bring and the file lacks is built, the rest is replaced; `99-drop-park` deletes the page of previous components when no instance outside it uses them (if some do, it keeps it and says which) |
| The screen is in a flow but not in Figma | It is added (`new`); `09-layout-screens` puts it in its app's section |
| The adapter changed (new component or prop) | `retag` in place and levels for what is new; if the piece lives inside components that already exist, `--full` |
| **The look of an existing component changed** (`plan.lookChanged`): an inner structure the baseline did not have, or a part with a text look (`ts`) it did not have —a label that lost its capitals in a box of the same size— | **Full** (`plan.full`): every screen is recaptured and the components are rebuilt; frames keep their ids. `build-level` never rebuilds a main that exists: without this, the new structure stayed as one more variant next to the old ones and the old text stayed in the main, corrected in every instance |

Report to the user in a table: screens recaptured / adjusted / untouched, tokens changed, components
new or with new variants, hand edits kept or overwritten, and the audit result. Never a JSON dump.

## Lessons from real runs

Every non-obvious rule in the templates came from a real failure. Before changing a template or
debugging a bad result, read the matching file: `references/lessons-capture.md`,
`references/lessons-components.md`, `references/lessons-execution.md`. A fix goes into the
template ("fixed in the template"), never only into one file.

## What this skill does NOT do

- It does not design from scratch or restyle the prototype: the file mirrors what the prototype
  draws.
- It does not interpret a prototype without the contract: an existing prototype needs the approved
  inventory and the migration first.
- It does not edit the user's original HTML, and it does not write to Figma during an update before
  the user has seen the report and resolved conflicts.
- It does not replace the designer's judgment: a conflict between a hand edit and the prototype is
  the user's call.
- It does not undo Figma changes: that is Figma's version history.
- Hover and focus states are not captured (the runtime could force them as a class and capture
  again).
- Mobile screens: the contract supports them (390×844), but the pipeline was proven on web.
- It is an independent project, not affiliated with or endorsed by Figma.
