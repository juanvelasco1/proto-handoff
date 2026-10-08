# proto-handoff-prototype

A companion skill for [proto-handoff](../../README.md). It teaches an AI prototype builder to write
single-file HTML prototypes that declare everything in the markup — tokens, components with
variants, screens, states, overlays and navigation — so proto-handoff can rebuild them as an editable
design file for Figma without guessing.

You do not need it for prototypes that already exist: proto-handoff migrates those without rewriting
them. Use it for new prototypes, to skip the migration and get a cleaner result.

## Install

| Where | How |
|---|---|
| Open Design | `od plugin install github:juanvelasco1/proto-handoff/open-design/proto-handoff-prototype` |
| Any Agent Skills client (Claude Code, Codex, Cursor, Gemini CLI, VS Code…) | `npx skills add https://github.com/juanvelasco1/proto-handoff/tree/main/open-design/proto-handoff-prototype`, or copy this folder into your client's skills folder |

## Files

| File | For |
|---|---|
| `SKILL.md` | The contract, as portable Agent Skills instructions. Its frontmatter uses only standard keys, so it also loads outside Open Design (including claude.ai uploads) |
| `open-design.json` | Open Design's sidecar manifest: prototype mode, craft references, example prompt. Other clients ignore it |

Open Design also reads an `od:` block inside `SKILL.md` frontmatter, but claude.ai uploads and the
Skills API reject unknown frontmatter keys. That is why the Open Design metadata lives in
`open-design.json` instead.

## What it asks the builder for

Vanilla HTML/CSS/JS in one file; every value a CSS custom property; flexbox layout; `data-ui`
components with props and slots; `data-ui-screen` screens reachable by hash routes with `state`,
`theme` and `overlay` parameters; every interactive element declaring its navigation; and a
`ui-manifest` listing flows, screens and overlays. The full rules and a self-check are in
`SKILL.md`.

## License

MIT, like the rest of the repository. Independent project, not affiliated with or endorsed by Figma
or Open Design.
