# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
