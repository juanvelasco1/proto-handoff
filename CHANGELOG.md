# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and versions follow [Semantic Versioning](https://semver.org/).

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
