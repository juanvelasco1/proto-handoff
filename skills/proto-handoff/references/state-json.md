# state.json and the work folder

Read this when creating a project, when a script complains about the state, or when the work
folder was damaged.

## The work folder

One per prototype, at `<workRoot>/<project>/` (default `~/.proto-handoff/projects/<project>/`),
created by `node scripts/init-project.mjs <project> <prototype.html>` **from the first step**.

- **Never inside the user's project, never in `/tmp` or a session scratchpad**: macOS deletes files
  in `/tmp` after 3 days without use (`bands.json`, `orig.html` and `tokens.json` were lost between
  two updates), and a session scratchpad disappears when the session restarts (a whole folder went
  away in the middle of a run).
- **If it happens anyway, the state can be rebuilt**: the adapter and the flows travel inside the
  migrated `-figma.html` copy (`window.__UI_ADAPTER__`, `ui-manifest`), and each Screens frame is
  recognized by its name (`F<k>·<i> · Title`) or its `uic.screen` data.
  `node scripts/rebuild-base.mjs <migrated -figma.html> <dir>` extracts `bands.json` and `orig.html`
  from the migrated copy (the `orig.html` is checked against the sha its manifest stored).
- **The original HTML is never touched.** Work on a copy (`orig.html`); the migrated version is
  `figma.html` (a copy handed back to the user carries the `-figma.html` suffix).

## state.json

```json
{ "source": "orig.html", "sourceSha": "…", "adapter": "adapter.json", "flows": "bands.json",
  "baseUrl": "http://127.0.0.1:8777/figma.html", "width": 1440, "height": 900,
  "themes": ["light", "dark"], "maps": "map", "shots": "shots", "fileKey": "…",
  "pages": { "cover": "0:1", "foundations": "…", "components": "…", "screens": "…", "flows": "…" },
  "pageNames": { "cover": "Cover", "foundations": "Foundations", "components": "Components",
                 "screens": "Screens", "flows": "User flows" },
  "section": "…",
  "style": { "pageBg": "#cacaca", "sectionFill": "#bdbdbd", "title": "#1a1c1f", "subtle": "#3d3f42", "gap": 200 },
  "options": { "docsLanguage": "en",
               "outputs": { "cover": true, "foundations": true, "flowMap": true, "darkScreens": true, "prototypeLinks": true },
               "audit": { "tolerancePx": 2, "minScreenPct": 90, "systematicScreens": 3 } },
  "groups": [{ "title": "<app>" }], "stageNotes": { "<stage>": "description of the board" },
  "screens": { "<screen id>": { "frame": "…", "dark": "…" } } }
```

- `width`, `height`, `baseUrl` (port), `pageNames`, `style` and `options` are copied from the user
  config when the project is created; later config edits do not change an existing project. The
  scripts read `options` with defaults equal to the values above, so an older state without it
  works unchanged.
- `pages` holds the page ids: `init-project.mjs pages-script` + `set-pages` fill it.
- `section` is where new screens wait until `09-layout-screens`; if it no longer exists, they wait
  on the page.
- `groups` gives the order of the Screens sections that the audit checks.
- `fileKey` identifies the user's Figma file. Treat the whole work folder as private: it holds the
  prototype, the file key and screenshots.
- Other files the update workflow keeps next to it: `next/` (the version being prepared),
  `fingerprints.json` (the last known state of the Figma file, for the hand-edit check) and
  `backups/<timestamp>/` (the local baseline before each promotion).
