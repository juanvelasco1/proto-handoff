# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-10-09

### Added

- Open Design manifest for the main skill (`skills/proto-handoff/open-design.json`): an export
  plugin, *Export to Figma*, that asks for the Figma design file, declares Figma's MCP server for
  the run and asks before the capture uploads the prototype. Install it with
  `od plugin install github:juanvelasco1/proto-handoff/skills/proto-handoff`.

## [0.1.1] - 2026-10-08

Fixes found by the first end-to-end run on a real prototype.

### Fixed

- The first build: `init-project.mjs pages-script` now creates the section new captures wait in
  (`state.section`); `sync.mjs detect` runs without baseline maps; `reconcile-captures.mjs` reads
  what `find-captures.js` returns and never wipes a capture table with an empty scan.
- The audit checks the screens of a first build (frames still in `next/plan.json`) and fails when
  any screen of the maps was not audited, instead of passing with none.
- The Components boards follow the documented stage order in both languages; the Screens section
  order comes from `groups.json`.
- The text census ignores the title block of each Screens section.
- `fix-text-boxes.js` says which right-aligned or centered texts it could not match.
- Components: a wrapping text in a box that hugs its width no longer collapses to one character
  per line; boxes sized by their content on every screen hug it (pills and titles no longer clip);
  one-line ellipsis texts end in "…"; `flex-grow` items and items pushed by an auto margin keep
  their place in the row; full-cover absolute layers stretch; text-only slot elements get their
  text property.
- A rotated glyph keeps its turn inside its icon component (instances of a turned chevron pointed
  the wrong way); existing icon components are mended in place.
- One-cell grids (`place-items: center`: avatars, icon buttons) become centered auto layout: a
  nested instance swapped to another grid component lost its row in Figma and its initials sat
  above it.
- An inset ring (`box-shadow: inset 0 0 0 1px`) becomes an inside stroke: Figma drew nothing on a
  transparent box.
- A growing flex item no longer loses its gap to `space-between`.
- Flex boxes the capture left without auto layout keep the margins between their items (a row
  7 px under its title moved up to it), keep their absolute layers where they were drawn, and get
  the same baked-margin check as the others (a wrapping bar was 12 px taller than the browser).
- The geometry audit counts as drift the downward offsets that Figma's whole-pixel text lines
  cause inside the instances, as it already did for the capture's own (at most 6 px, never up or
  sideways); the strict share is still reported.
- Slot texts are recorded whole (they were cut at 80 characters, and the slot check wrote the cut
  text into the instances).
- Component descriptions follow the documentation language.
- Colors written with `color-mix()`, `oklch()`, `lab()` and the like reach the capture: the
  runtime writes them back as `rgb()` before capturing (a toggle's inset ring was missing).
- A full-cover picture (a canvas of dots) covers its box in every instance instead of fitting
  one occurrence's bitmap and leaving bands.

### Changed

- The contract runtime tags one-line ellipsis boxes (`ov:e`) and adds the growing and pushed items
  to the flex tag (`fx:…:3g1a2`). Prototypes migrated before this version keep working; migrate
  again to get the new tags.

### Added

- `scripts/template.mjs` fills a one-off template (`find-captures`, `census-type`).
- Documentation of the first-build steps, the `adapter.json` and `bands.json` formats, and how a
  recipe step picks the hotspot of a prototype link.

## [0.1.0] - 2026-09-30

First public release.

### Added

- HTML prototype to an editable design file for Figma: variables with light and dark modes,
  components with variants and slots, icons, screens made of instances, prototype links,
  foundations, cover, flow map and a self-audit.
- Safe updates: human-readable change report, detection of hand edits made in Figma, audit gate,
  local backups and rollback.
- Personal configuration in `~/.proto-handoff/config.jsonc`, validated before every run.
- Preflight check (`doctor.mjs`) with full, analysis-only and blocked modes.
- Documentation text in English or Spanish.
- Companion Open Design skill to generate prototypes that follow the contract.
