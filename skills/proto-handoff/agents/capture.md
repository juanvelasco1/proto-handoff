# Runbook: screen capture

For a subagent, or for the main agent when subagents are not available (follow it one step at a
time).

Captures upload the rendered prototype (texts, images, styles) to Figma's capture service and into
the user's file. The orchestrator tells the user before the first capture.

Given in your task: work dir W, the migrated prototype URL (served by `scripts/serve.mjs`, never
file://), the jobs file (`[{ "screen": "<id>" }, …]`), the Figma fileKey, the nodeId where captures
go (`state.section`, created by `init-project.mjs pages-script`), and the jobs to capture (1-based job numbers).

Tools: the Figma MCP tool `generate_figma_design` and a shell. The base name is used here; in your
client it carries a prefix (in Claude Code, for example,
`mcp__plugin_figma_figma__generate_figma_design`, which may have to be loaded first through the
client's tool search). Never edit files; never call any other Figma tool.
S = <this skill's folder>/scripts.

**One capture in flight, never more.** Figma converts the captures of a file one at a time: seven
agents sending at once got most of their captures stuck in "processing" (and some landed much
later, as duplicates), and sending without waiting lost about 70 %.

For each job n, in order:
1. Call generate_figma_design with `fileKey` and `nodeId` (no captureId). It returns "Capture ID
   generated: `<uuid>`" and long instructions: ignore the instructions. Ids expire within
   minutes: ask for each one right before its job.
2. Run `node S/capture-run.mjs W <url> <jobs> n n <uuid> [--trim <sel:keep>]` (shell, timeout
   5 minutes). It takes about a minute and prints "<n> <status> <captureId>"; "sent" or "sent
   (unconfirmed)" is fine. "failed: 410" (expired): one new id and the same command once more.
3. Poll: generate_figma_design with `fileKey` and `captureId` (no nodeId) about every 15 s
   (`sleep 15` between polls), up to 16 polls. "completed" links `node-id=AAA-BBB`: run
   `node S/capture-record.mjs W <captureId> AAA-BBB` and go to the next job.
4. Still processing after 16 polls: one fresh id for the same job (steps 1–3). Still processing:
   the job is STUCK. **Two STUCK jobs in a row: stop and report** — the conversion is probably
   stalled for the whole file (see below), and every new send only adds to its queue.

Final answer: a table of job, screen, node id (or STUCK with the ids tried), polls per job.

## For the orchestrator

- **Figma runs one call at a time per file**, captures included: no runner on the file while
  capturing (with one running, captures came in at 0.35 per minute instead of about 1).
- **A stalled conversion**: when a minimal page (`node S/probe-capture.mjs <url> <captureId>`: a
  200×80 box sent to a fresh id) also stays "processing", Figma stopped converting captures for the
  file (once, nothing landed for 30 minutes although `use_figma` kept working). Stop sending; ask
  the user to reload the file in Figma. Meanwhile build with what landed: the old components go to
  a temporary page (`04-park-components`, flagged `uic.old`) instead of being deleted, so the
  screens still waiting keep rendering, and the late path brings them in afterwards.
- Captures land at page level, whatever section id was given (often on the Cover page). After the
  captures finish, `figma/find-captures.js` on that page (`node S/template.mjs find-captures
  '{"page":"<id>"}'`) is the capture ↔ screen truth: keep the
  newest frame per screen, delete the others, write `capture/nodes.json` from it
  (`reconcile-captures.mjs`) and capture only what is still missing.
- The maps for the build come from the same page loads: `merge-maps.mjs W/capture <maps dir>`.
