# Lessons from real runs: running scripts in Figma

Read this before running any generated script (with or without the runner runbook) and whenever a
call is cut, hangs, goes to the background or fails.

- **A 20 KB script takes minutes to travel and can be cut**: that is why the templates are
  installed once and each call carries only parameters. A call over 50,000 characters does not go
  out.
- **A template over 50,000 characters is installed in parts** (`installParts`), in order; the last
  part writes the hash, so a half-installed template never runs.
- **The kit has three parts** (`lib/figma-kit.js`): the common part, the `/*@build*/` block and the
  `/*@swap*/` block; `fill.mjs` leaves in each installed template only its block. A function both
  use (`trimGrid`, `wrapWidth`) goes in the common part; in a block, the other template fails with
  `ReferenceError` on first use and stops the whole chain. Before installing, each variant is
  checked with `new Function` over the trimmed text.
- **A failing script leaves nothing half-done** (Figma rolls it back), but **a call that moves to
  the background keeps running**: sending the next one before it ends mixes steps.
- **Figma runs a file's calls one at a time**, captures included: two 6 s `use_figma` calls sent at
  once finished one after the other. Several runners in parallel speed nothing up, and **a runner
  working while captures run slows the captures down** (with an install running, 0.35 screens per
  minute came in; alone, about 1). While capturing, prepare everything that does not touch Figma
  (maps, scripts, the skill) and run it afterwards. More capture agents only help until the file is
  busy all the time.
- **Read log timestamps in the user's local timezone** before declaring a process hung.
- **The connection with Figma sometimes drops mid-call** ("transport dropped"): the response is
  lost, but the work may have been done fully, partly or not at all (level 0 in full, 66 components
  across 83 screens, saved nothing twice; a batch of replacements was done completely and only its
  report was lost). Therefore: levels are built 10 components at a time (5–16 s per call),
  replacements go in batches of 10 screens, long templates yield control every ~1.5 s (`breathe()`
  in the kit) and **every template is idempotent**: building skips components that exist and
  replacing skips what is already an instance, so a cut is retried once without risk. What the lost
  report did not say, the audit says (browser census against instances, screen by screen). When the
  runner stops after two drops in a row on a page step (`05z-organize` with 187 components,
  `09-layout-screens`), look at the page before repeating it: once, the organizer had finished both
  times (every component in its card, the sections in a row) and only the response was lost.
- **Build and replace are resumable**: each call has a 40 s budget (`budgetMs`; 25 s while captures
  are running, because the connection drops more often). Past that time it does not start another
  component (build) or another occurrence (replace), returns `_pending` with what is left and the
  chain stops there (`pending: true`). The runner runs the same script again until nothing is
  pending. The time cannot be predicted by size: a table with 19 occurrences took 73 s and a panel
  with 28, less than 1 s.
