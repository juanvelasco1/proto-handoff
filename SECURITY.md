# Security policy

## Supported versions

Only the latest release receives fixes.

| Version | Supported |
|---|---|
| 0.1.x | yes |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it privately through GitHub: go to the repository's **Security** tab → **Report a
vulnerability** (GitHub private vulnerability reporting). Only the maintainer sees it.

Include, if you can:

- What the problem is and what an attacker could do with it.
- Steps to reproduce, with synthetic data only (never a real client prototype, `state.json` or a
  link to a private Figma file).
- The version and the AI tool you used.

This is a one-person project maintained on a best-effort basis: expect a first answer within a
week. Once fixed, the report is credited in the changelog unless you prefer otherwise.

## Scope

In scope:

- The scripts in `skills/proto-handoff/scripts/`, including the local server (`serve.mjs`), which
  must only listen on `127.0.0.1` and only serve web assets.
- Anything that could leak a user's prototype, work folder, Figma file key or configuration.
- Instructions in `SKILL.md` or `agents/` that could make an agent run something unsafe.

Out of scope: Figma's own services and MCP server, and the AI tools that run the skill. Report
those to their vendors.

## How the skill handles sensitive data

- It stores **no credentials**: Figma access goes through the user's AI tool and Figma's MCP
  server, which handle sign-in.
- Work data stays in `~/.proto-handoff/` on the user's computer. Nothing is sent to the maintainer; there
  is no telemetry.
- Captured screens are uploaded to Figma by Figma's capture service, into the user's own file.

If you ever find a credential or private data in this repository or its history, report it
privately as above.
