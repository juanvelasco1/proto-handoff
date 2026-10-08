# Runbook: script runner

For a subagent, or for the main agent when subagents are not available (follow it one step at a
time).

You run pre-generated Figma Plugin API scripts (plain JavaScript that edits the user's own design
file) with the Figma MCP tool `use_figma`, exactly as written, and log their results. Do not edit,
fix, reorder or improvise anything.

Setup:
- Tool names: this runbook uses the base name `use_figma`. In your client the tool carries a
  prefix (in Claude Code, for example, `mcp__plugin_figma_figma__use_figma`, which may have to be
  loaded first through the client's tool search). Use whatever name your client exposes.
- If your client ships Figma's `figma-use` skill, load it once before the first `use_figma` call.

Given in your task: the Figma fileKey, the scripts directory D and the files to run, in order.
Log file: D/run.log (one JSON line per script).

If the list starts with `00-install-check.js`, run it first: its result names in `skip` the install
scripts the file already has — do not run those (log them as `{"file":"<name>","result":"skipped"}`).

For each script, in order:
1. Read the whole file (all of it; install scripts are ~22–40 KB).
2. Call `use_figma` with the fileKey, `code` = the ENTIRE file content unchanged,
   description = "<file name>" (and skillNames = "figma-use" if the tool accepts it).
3. Append one line to D/run.log with your shell tool, using a heredoc with a quoted delimiter:
   `{"file":"<name>","result":<the returned JSON, or the error text as a JSON string>}`
   If use_figma replies that the call "is still running" and was moved to the background, the
   script is still executing in Figma: wait for its completion notification, log THAT result, and
   only then go on. Never start the next script while one is still running.
4. Decide:
   - The call was interrupted before running, or the code arrived cut (syntax error such as
     "Unexpected end of input"): retry the same script once (a cut script never runs).
   - The result says `"pending": true`, or has a non-empty `_pending` list (at the top or inside a
     step's `r`): the script stopped at its time budget on purpose. Log it and run the SAME script
     again; repeat until nothing is pending (at most 8 runs of the same script, then STOP). Build
     and swap skip what is already done, so each run continues where the last one stopped.
   - The transport dropped mid-call ("transport dropped", "response ... was lost"): log it and
     retry the same script once. The templates are idempotent (a build skips the components that
     exist, a swap skips what is already an instance), so a retry never duplicates. A second drop
     on the same script: STOP.
   - Figma answers "An unexpected error occurred" with a Debug UUID and no JavaScript error: treat
     it like a dropped transport (retry once; a second one on the same script: STOP).
   - An install script answers that the code "arrived changed in transit": run the SAME script
     again, unchanged (at most 3 runs; nothing was stored). Emit it exactly as read: every
     backslash, backtick and `~bt~`/`~dl~` marker as it is in the file.
   - The result is a JSON object with an "error" key (also inside `steps`), or the tool returned a
     JavaScript/Figma error: STOP. Do not run the next script.
   - Otherwise continue.

Final answer: one line per script run: its name and a compact summary of its result (for build and
swap results: per component occurrences→variants or swapped/added/failed; keep every "failed",
"error" or "added" detail verbatim). If you stopped, say at which script and quote the error.
