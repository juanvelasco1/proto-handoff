# proto-handoff

**HTML prototype → editable design file for Figma, kept in sync.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.1-informational.svg)](CHANGELOG.md)
[![Agent Skill](https://img.shields.io/badge/Agent%20Skill-SKILL.md-8A2BE2.svg)](https://agentskills.io/specification)

[Español](README.es.md)

proto-handoff is an [Agent Skill](https://agentskills.io) that takes a single-file HTML prototype
(from [Open Design](https://github.com/nexu-io/open-design) or any AI builder) and rebuilds it in
Figma as real design work, not screenshots:

- **Variables** with light and dark modes, each linked to its CSS variable.
- **Components for everything that repeats**, containers included (sidebar, header, panels), with
  variants, boolean and text properties, and slots for table rows and container content.
- **Icons as components**, **screens made of instances**, a **clickable prototype**.
- **Documentation pages**: cover, foundations (color, type, spacing, layout, icons, elevation,
  radii), components by category, screens by app, and a **flow map**.
- **A self-audit** that measures every screen against the browser and fails loudly.
- **Safe updates**: when the prototype changes, it reports what would change, detects edits made by
  hand in Figma, asks before overwriting them, backs up, and touches only what changed.

> Independent project. Not affiliated with, endorsed or sponsored by Figma, Inc. or Open Design.

## Requirements

| Requirement | Why | If it's missing |
|---|---|---|
| An AI tool that runs code and reads/writes files | The skill drives Node scripts | **Does not work** |
| Node.js 18 or newer | Capture, migration, sync, audit | **Does not work** |
| Google Chrome or Chromium | Renders each screen to capture and measure it | **Does not work** |
| Figma's MCP server with `use_figma` and `generate_figma_design` | Writing to the file and capturing screens | **Analysis-only mode**: tokens, component inventory, migration, screenshots and update reports, nothing written to Figma |
| A Figma **Full seat** with edit access to the file | Figma requires it for `use_figma` | Analysis-only mode |
| Internet access to Figma | Captures load Figma's capture script | Analysis-only mode |
| A large context window | Big prototypes (80+ screens) | Works, in smaller batches (the scripts hold the heavy data, not the chat) |

The skill checks all of this itself before starting (`node scripts/doctor.mjs`) and tells you
which mode it can run in. It never fails silently or half-way.

> Figma's write-to-canvas tools are free during their beta; Figma has announced they will become
> usage-based paid, and read tools have plan-based rate limits. Check
> [Figma's MCP access and limits](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/).

## Compatible AI tools

proto-handoff follows the open Agent Skills format. It needs a tool that loads skills, runs code and
is in Figma's MCP catalog. As of September 2026:

| Tool | Loads skills | Figma `use_figma` | Figma `generate_figma_design` | Expected mode |
|---|---|---|---|---|
| Claude Code | yes | yes | yes | Full (tested) |
| OpenAI Codex | yes | yes | yes | Full (not tested yet) |
| Cursor | yes | yes | yes | Full (not tested yet) |
| VS Code with GitHub Copilot | yes | yes | yes | Full (not tested yet) |
| GitHub Copilot CLI | yes | yes | no | Variables only + analysis |
| Gemini CLI | yes | not in Figma's catalog | not in Figma's catalog | Analysis-only |
| Claude Desktop / claude.ai | yes | yes | no | Not supported (no local Node) |

Sources: [Figma MCP catalog](https://www.figma.com/mcp-catalog/),
[write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/). If you run
it in another tool, please [report how it went](https://github.com/juanvelasco1/proto-handoff/issues).

## Install

**Claude Code** (as a plugin):

```sh
claude plugin marketplace add juanvelasco1/proto-handoff
claude plugin install proto-handoff@proto-handoff
```

**Any tool** (with the [skills CLI](https://skills.sh)):

```sh
npx skills add juanvelasco1/proto-handoff
```

**By hand**: copy `skills/proto-handoff` into your tool's skills folder
(`~/.claude/skills/` for Claude Code; `~/.agents/skills/` for Codex, Cursor, Gemini CLI and VS Code).

Then, once:

```sh
cd <skills folder>/proto-handoff/scripts
npm install          # your agent can do this for you
node setup.mjs       # optional: creates your config
node doctor.mjs      # checks everything
```

You also need [Figma's MCP server](https://developers.figma.com/docs/figma-mcp-server/) connected
in your AI tool.

## Use

Ask your agent, in any language:

> Turn `./my-prototype.html` into a Figma file: https://www.figma.com/design/…

> The prototype changed (`./my-prototype-v2.html`). Update the Figma file.

For new prototypes, generate them already handoff-ready with the companion skill in
[`open-design/proto-handoff-prototype`](open-design/proto-handoff-prototype/). Existing prototypes are
migrated without rewriting them.

## Configure

Your settings live in **one file outside the skill**: `~/.proto-handoff/config.jsonc` (created by
`node scripts/setup.mjs`, documented line by line in
[`config.example.jsonc`](skills/proto-handoff/config.example.jsonc)). Updating the skill never
overwrites it. Every setting is optional; an invalid value stops the skill with a clear message.

| You can configure | Fixed on purpose (so a setting can't break the skill) |
|---|---|
| Language for chatting and for text written into Figma (`en` / `es`) | The `data-ui` contract and capture tags |
| Where work folders live, server port | The order of the scripts |
| Viewport (desktop, tablet, phone) | Idempotency and the audit loop |
| Page names | The `state.json` schema |
| What to generate: cover, foundations, flow map, dark screens, prototype links | Mode names Light/Dark, slot names |
| Documentation page colors | |
| Audit strictness (tolerance, minimum match per screen) | |
| Chrome path, whether to use subagents | |

No tokens or passwords: the skill reaches Figma only through your AI tool's Figma connection.

## Updating a file when the prototype changes

1. **Check**: a readable report of new, modified, removed and unchanged screens, token changes
   and components touched. Nothing is written to Figma.
2. **Hand-edit check**: compares the file with a fingerprint taken after the last update and lists
   every edit made in Figma since, marking the ones the update would overwrite. You decide each.
3. **Apply**, only after you confirm, touching only what changed.
4. **Audit gate**: if the audit fails, the update is not promoted. A local backup is taken first.
5. **Undo**: `update.mjs rollback` restores the local state; Figma's own version history undoes
   changes in the file.

## Privacy and data

- **What leaves your computer**: the rendered screens of your prototype (texts, images, styles)
  are uploaded to Figma through Figma's capture service, into your file. The scripts that edit the
  file run inside Figma through your AI tool's Figma connection. Your AI tool's provider processes
  what the agent reads, under that provider's terms.
- **What never leaves**: nothing is sent to the author of this skill. No telemetry, no analytics,
  no tracking.
- **What stays on your computer**: `~/.proto-handoff/` (config, and per project: a copy of the
  prototype, screenshots, maps, the Figma file key, backups). Delete that folder to remove it all.
  Keep work folders out of git repositories.
- **The local server** listens only on `127.0.0.1` and serves only web assets (never `state.json`
  or logs).
- Don't put real personal or confidential data in prototypes you capture; use sample data.

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## What it does NOT do

- Design from scratch or restyle your prototype: the file mirrors what the prototype draws.
- Work with multi-file apps or frameworks directly: it takes one self-contained HTML file.
- Capture hover and focus states.
- Replace the designer's judgment: conflicts between hand edits and the prototype are your call.
- Undo changes in Figma: that is Figma's version history.
- Mobile layouts are supported by the contract but have been tested less than desktop.

## Contributing

Issues and pull requests are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Never attach real client prototypes, `state.json` files or
links to private Figma files.

## License

[MIT](LICENSE) © 2026 juanvelasco1.

Figma is a trademark of Figma, Inc. Open Design is a project of its respective authors. They are
named here only to describe compatibility.
