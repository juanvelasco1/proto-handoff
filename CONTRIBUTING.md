# Contributing

Thanks for helping. A few rules keep the skill reliable and everyone's data safe.

## Before you start

- Open an issue first for anything bigger than a small fix, so we agree on the approach.
- **Never include real data**: no client prototypes, screenshots of private work, `state.json`
  files, Figma links or file keys in issues, pull requests or test fixtures. Use synthetic
  prototypes.

## How the project is organized

| Folder | What it is |
|---|---|
| `skills/proto-handoff/SKILL.md` | The instructions the agent follows. Keep it tool-neutral (base tool names, no product-specific features) and under ~450 lines; long material goes to `references/` |
| `skills/proto-handoff/scripts/` | Node scripts; `figma/` holds templates that run inside Figma |
| `skills/proto-handoff/agents/` | Runbooks for delegated steps (subagents are optional) |
| `skills/proto-handoff/config.example.jsonc` | Every user setting, documented. Settings are preferences only: never make the mechanics (contract, script order, idempotency, audit, state schema) configurable |
| `open-design/` | The companion skill for Open Design |
| `tools/` | Maintenance scripts |

## Rules for changes

- **Fix the template, not one file**: a bug found in a generated Figma file is fixed in the template
  that produced it.
- **Every template stays idempotent**: running it twice must not duplicate anything.
- **Nothing writes to Figma without the user seeing the change first** (updates go through
  `update.mjs check` and the conflict check).
- New settings need a default equal to the current behavior, validation in
  `scripts/lib/config.mjs` and a documented line in `config.example.jsonc`.
- Text shown inside Figma goes through `scripts/lib/labels.mjs` (English and Spanish).
- Code, comments and commit messages in English.

## Checks

```sh
cd skills/proto-handoff/scripts && npm install && cd -
node --test tests/*.test.mjs
node tools/prepublish-check.mjs
```

All must pass. CI runs them on every pull request.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
