# House style of the documentation pages

Read this before the organize, foundations, layout, flow-map and cover steps. It comes from a
designer arranging the Components page by hand and applies the same way to Cover, Components,
Foundations and Screens; User flows keeps its vertical structure and only takes the colors.

The colors and the gap come from the config (`style.*`, copied into `state.style` when the project
is created). The values below are the defaults.

| Rule | Value (config key) |
|---|---|
| Page background | `#cacaca` (`style.pageBg`) |
| Container of each group | `SECTION` with a solid fill `#bdbdbd` (`style.sectionFill`) |
| Position | The sections in **one horizontal row, aligned to the top**, in order, 200 px apart (`style.gap`) (User flows: in a column, in its order) |
| Heading | Title 40 Semi Bold `#1a1c1f` (`style.title`) + description 16 `#3d3f42` (`style.subtle`), at (80, 60) |
| Content | Cards or boards from y = 200, 64 px apart |
| Text on the gray | AA with the defaults: ink 9.1:1, description 5.6:1, arrows 3.9:1. Never the theme tokens (the theme's `muted` gives 3.3:1 on `#bdbdbd`). If the user changes these colors, the audit checks AA again on the sections |

| Page | Groups |
|---|---|
| Cover | One section: summary, source data, how to read the file, index linked to each screen, glossary (`scripts/gen-docs.mjs`) |
| Components | One section per inventory stage + Icons |
| Foundations | One section per topic (Color, Typography, Spacing, Layout and grid, Iconography, Elevation, Borders and radii); inside, its light and dark boards side by side (`figma/foundation-board.js`, `figma/relayout-foundations.js`) |
| Screens | One section per app (`groups.json`); each screen with its dark copy below (`figma/layout-screens.js`) |
| User flows | One band per flow, grouped by app, in a column; `#bdbdbd` sections (`scripts/gen-flowmap.mjs`) |

The page names come from the config (`pageNames.*`); the labels written inside Figma (section
titles, card texts, the cover) follow `docsLanguage` (`scripts/lib/labels.mjs`).

**Documentation colors are not theme tokens**: on `#bdbdbd` the theme's `muted` does not reach AA.
Headings use fixed inks.
