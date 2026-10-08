#!/usr/bin/env node
// Safe updates: look first, write later, keep a way back.
//
//   node update.mjs check     <dir> <new.html>        what changed (Figma untouched) → next/report.md
//   node update.mjs report    <dir>                   show that report again
//   node update.mjs fp-script <dir>                   read-only fingerprint scripts → <dir>/fp/gen/
//   node update.mjs fp-read   <dir> --as current|baseline   collect their results (fp/gen/run.log)
//   node update.mjs conflicts <dir>                   hand edits in Figma the update would overwrite
//   node update.mjs promote   <dir> [--force]         audit gate + local backup + promote
//   node update.mjs rollback  <dir> [<backup>]        restore the local baseline from a backup
//   node update.mjs backups   <dir>                   list the backups
//
// The order is always: check → (fp-script, run, fp-read --as current, conflicts) → the user
// confirms → capture and apply (sync.mjs figma, runner) → audit → promote → baseline fingerprint.
// Nothing here writes to Figma: fingerprints are read-only scripts; everything else is local.
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync, renameSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fill } from './lib/fill.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [cmd, dirArg, ...rest] = process.argv.slice(2);
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };
const USAGE = 'usage: update.mjs check <dir> <new.html> | report <dir> | fp-script <dir> | fp-read <dir> --as current|baseline | conflicts <dir> | promote <dir> [--force] | rollback <dir> [<backup>] | backups <dir>';
if (!cmd || !dirArg) fail(USAGE);
const dir = path.resolve(dirArg);
const W = (...p) => path.join(dir, ...p);
if (!existsSync(W('state.json'))) fail(`No state.json in ${dir}: is this a proto-handoff work folder?`);
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const state = readJson(W('state.json'));
const KEEP_BACKUPS = 10;

const stamp = () => {
  const d = new Date();   // local time: the user reads these names
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
const titles = (() => {
  const f = existsSync(W('next', 'figma.html')) ? W('next', 'figma.html') : W('figma.html');
  try {
    const m = readFileSync(f, 'utf8').match(/<script type="application\/json" id="ui-manifest">([\s\S]*?)<\/script>/);
    const man = JSON.parse(m[1].replace(/<\\\/script/gi, '</script'));
    return Object.fromEntries(Object.entries(man.screens || {}).map(([k, v]) => [k, v.title || k]));
  } catch { return {}; }
})();
const titleOf = (s) => (titles[s] && titles[s] !== s ? `${titles[s]} (${s})` : s);

// ---------------------------------------------------------------------------------------------
if (cmd === 'check') {
  const src = rest[0];
  if (!src || !existsSync(src)) fail('usage: update.mjs check <dir> <new.html>');
  // detect renders the new version through the local server: start one for the check if none answers
  const port = +(new URL(state.baseUrl).port || 80);
  let server = null;
  const up = async () => { try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; } };
  if (!(await up())) {
    server = spawn(process.execPath, [path.join(here, 'serve.mjs'), dir, '--port', String(port)], { stdio: 'ignore' });
    for (let i = 0; i < 20 && !(await up()); i++) await new Promise((ok) => setTimeout(ok, 250));
  }
  // a server that answers must be serving THIS work folder, not another project's
  try {
    const served = await (await fetch(`http://127.0.0.1:${port}/${state.source || 'orig.html'}`, { signal: AbortSignal.timeout(3000) })).text();
    if (served !== readFileSync(W(state.source || 'orig.html'), 'utf8')) throw new Error('different folder');
  } catch {
    if (server) server.kill();
    fail(`Port ${port} answers, but with another folder's files (a server from another project is using it). Stop that server and run the check again, or move this project to a free port: change the port in baseUrl in ${W('state.json')}.`);
  }
  const r = await new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(here, 'sync.mjs'), 'detect', dir, path.resolve(src)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.on('close', (status) => ok({ status, stdout }));
  });
  if (server) server.kill();
  if (r.status !== 0) fail(`The change detection failed (nothing was changed). Its error is above.`);
  let out;
  try { out = JSON.parse(r.stdout); } catch { fail(`Unexpected output from sync.mjs detect:\n${r.stdout.slice(0, 2000)}`); }
  if (!out.changed) {
    console.log('No changes: the prototype, its component list and its flows are the same as the last update. Figma is up to date.');
    process.exit(0);
  }
  const md = buildReport();
  writeFileSync(W('next', 'report.md'), md);
  console.log(md);
  process.exit(0);
}

if (cmd === 'report') {
  if (!existsSync(W('next', 'plan.json'))) fail('There is no pending update. Run: update.mjs check <dir> <new.html>');
  const md = buildReport();
  writeFileSync(W('next', 'report.md'), md);
  console.log(md);
  process.exit(0);
}

function tokenValue(t) {
  if (!t) return '—';
  const vals = Object.values(t.values || {});
  const hex2 = (c) => Math.round(c * 255).toString(16).padStart(2, '0');
  const fmt = (v) => {
    if (v && typeof v === 'object' && 'r' in v) return `#${hex2(v.r)}${hex2(v.g)}${hex2(v.b)}${v.a !== undefined && v.a < 1 ? ` ${Math.round(v.a * 100)} %` : ''}`;
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  if (!vals.length) return '—';
  return vals.every((v) => fmt(v) === fmt(vals[0])) ? fmt(vals[0]) : Object.entries(t.values).map(([th, v]) => `${th}: ${fmt(v)}`).join(' · ');
}

function buildReport() {
  const plan = readJson(W('next', 'plan.json'));
  const rows = plan.screens || [];
  const removed = plan.removed || [];
  const isNew = (r) => r.kind === 'new';
  const unchanged = rows.filter((r) => r.action === 'none' && !plan.full);
  const modified = rows.filter((r) => !isNew(r) && (r.action !== 'none' || plan.full));
  const created = rows.filter(isNew);
  const doing = (r) => {
    if (plan.full && !isNew(r)) return 'Recaptured (full rebuild), frame and links kept';
    return { recapture: 'Recaptured; its components reused or given new variants', patch: 'Adjusted in place (boxes moved or resized)', retag: 'Re-tagged in place (component list changed)', none: 'Left alone' }[r.action] || r.action;
  };
  const change = (r) => (isNew(r) ? 'New' : plan.full && r.action === 'none' ? 'Rebuilt' : { structure: 'Layout changed', pixels: 'Look changed', none: 'No visible change' }[r.kind] || r.kind);
  const px = (r) => Object.entries(r.pixels || {}).map(([th, v]) => `${th} ${v} %`).join(' · ') || '—';
  const tokOld = existsSync(W('tokens.json')) ? Object.fromEntries(readJson(W('tokens.json')).tokens.map((t) => [t.name, t])) : {};
  const tokNew = existsSync(W('next', 'tokens.json')) ? Object.fromEntries(readJson(W('next', 'tokens.json')).tokens.map((t) => [t.name, t])) : {};
  const tk = plan.tokens || { added: [], changed: [], removed: [] };
  const tokenRows = [
    ...tk.changed.map((n) => [n, 'Changed', tokenValue(tokOld[n]), tokenValue(tokNew[n])]),
    ...tk.added.map((n) => [n, 'New', '—', tokenValue(tokNew[n])]),
    ...tk.removed.map((n) => [n, 'Removed', tokenValue(tokOld[n]), '—']),
  ];
  const lines = [
    `# Update report: ${path.basename(dir)}`,
    '',
    `Prepared ${new Date().toLocaleString('sv-SE').slice(0, 16)}. **Nothing has been changed in Figma yet.**`,
    '',
    '## Summary',
    '',
    table(['What', 'How many'], [
      ['New screens (captured and added)', created.length],
      ['Modified screens', `${modified.length}${modified.length ? ` (recapture ${modified.filter((r) => plan.full || r.action === 'recapture').length}, adjust in place ${plan.full ? 0 : (plan.patch || []).length}, re-tag ${plan.full ? 0 : (plan.retag || []).length})` : ''}`],
      ['Removed screens (their frames are deleted)', removed.length],
      ['Unchanged screens (left alone)', unchanged.length],
      ['Tokens new / changed / removed', `${tk.added.length} / ${tk.changed.length} / ${tk.removed.length}`],
      ['Components touched', (plan.componentsTouched || []).length],
      ['Screens to capture', (plan.recapture || []).length],
      ['Full rebuild', plan.full ? `Yes: ${plan.full}` : 'No'],
    ]),
    '',
  ];
  if (plan.full) {
    lines.push('> A full rebuild recaptures every screen and rebuilds the components. Frames keep their ids and prototype links; edits made by hand inside components or screens are replaced. Check the hand-edit report before confirming.', '');
  }
  // in a full rebuild every screen is recaptured: list the ones that really changed, count the rest
  const reallyChanged = modified.filter((r) => !plan.full || r.kind !== 'none');
  const rebuiltOnly = modified.length - reallyChanged.length;
  const changedRows = [...created, ...reallyChanged];
  lines.push('## Screens that change', '');
  lines.push(changedRows.length || removed.length
    ? table(['#', 'Screen', 'Change', 'What the update does', 'Pixels that differ'], [
      ...changedRows.map((r) => [r.n, titleOf(r.screen), change(r), isNew(r) ? 'Captured and added to its section' : doing(r), px(r)]),
      ...removed.map((s) => ['—', titleOf(s), 'Removed from the flows', 'Its light and dark frames are deleted', '—']),
    ])
    : 'None.', '');
  if (rebuiltOnly) lines.push(`Plus ${rebuiltOnly} screen(s) with no change of their own, recaptured only because of the full rebuild (frames and links kept).`, '');
  if (unchanged.length) lines.push(`Unchanged (${unchanged.length}): ${unchanged.map((r) => titles[r.screen] || r.screen).join(', ')}.`, '');
  lines.push('## Tokens', '', tokenRows.length ? table(['Token', 'Change', 'Before', 'After'], tokenRows) : 'No token changes.', '');
  lines.push('## Components', '');
  if ((plan.componentsTouched || []).length) lines.push(`Touched: ${plan.componentsTouched.join(', ')}.`, '');
  if ((plan.lookChanged || []).length) lines.push(`Look changed (rebuilt): ${plan.lookChanged.join(', ')}.`, '');
  if (!(plan.componentsTouched || []).length && !(plan.lookChanged || []).length) lines.push('No component changes detected.', '');
  lines.push('## Next steps', '',
    '1. Check for edits made by hand in Figma since the last update (`update.mjs fp-script`, run, `fp-read --as current`, `conflicts`).',
    `2. With your OK: capture ${(plan.recapture || []).length} screen(s), apply the update and audit it.`,
    '3. If the audit passes: a local backup is taken and the update becomes the new baseline. Figma keeps its own version history (File → Show version history).',
    '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
if (cmd === 'fp-script') {
  const out = W('fp', 'gen');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const list = Object.entries(state.screens || {}).map(([screen, v]) => ({ screen, frame: v.frame || null, dark: v.dark || null })).filter((s) => s.frame || s.dark);
  const files = [];
  const PER = 6;
  for (let i = 0, k = 0; i < list.length; i += PER, k++) {
    const name = `fp-s${String(k + 1).padStart(2, '0')}.js`;
    writeFileSync(path.join(out, name), fill('fingerprint.js', { screens: list.slice(i, i + PER), componentsPage: null, variables: false, budgetMs: 35000 }));
    files.push(name);
  }
  if (state.pages?.components) {
    writeFileSync(path.join(out, 'fp-components.js'), fill('fingerprint.js', { screens: [], componentsPage: state.pages.components, variables: false, budgetMs: 35000 }));
    files.push('fp-components.js');
  }
  writeFileSync(path.join(out, 'fp-variables.js'), fill('fingerprint.js', { screens: [], componentsPage: null, variables: true, budgetMs: 35000 }));
  files.push('fp-variables.js');
  console.log(JSON.stringify({ dir: out, run: files, readOnly: true,
    then: `run them in this order with use_figma (runner runbook, D=${out}), then: node update.mjs fp-read <dir> --as current|baseline` }, null, 1));
  process.exit(0);
}

if (cmd === 'fp-read') {
  const ai = rest.indexOf('--as');
  const as = ai >= 0 ? rest[ai + 1] : null;
  if (!['current', 'baseline'].includes(as)) fail('usage: update.mjs fp-read <dir> --as current|baseline');
  const gen = W('fp', 'gen');
  const log = path.join(gen, 'run.log');
  if (!existsSync(log)) fail(`No results yet: run the scripts in ${gen} first (their results go to run.log).`);
  const expected = readdirSync(gen).filter((f) => /^fp-.*\.js$/.test(f)).sort();
  const last = {};
  for (const line of readFileSync(log, 'utf8').split('\n').filter(Boolean)) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    let r = e.result;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { /* an error text */ } }
    last[e.file] = r;
  }
  const bad = expected.filter((f) => !last[f] || typeof last[f] !== 'object' || last[f].error);
  if (bad.length) fail(`Missing or failed results for: ${bad.join(', ')}. Run those scripts again, then fp-read.`);
  const fp = { takenAt: new Date().toISOString(), sourceSha: state.sourceSha, screens: {}, components: null, variables: null, missing: [], incomplete: [] };
  for (const f of expected) {
    const r = last[f];
    Object.assign(fp.screens, r.screens || {});
    if (r.components) fp.components = Object.assign(fp.components || {}, r.components);
    if (r.variables) fp.variables = Object.assign(fp.variables || {}, r.variables);
    fp.missing.push(...(r.missing || []));
    fp.incomplete.push(...(r.incomplete || []));
  }
  let target;
  if (as === 'baseline') target = W('fingerprints.json');
  else {
    if (!existsSync(W('next', 'plan.json'))) fail('There is no pending update: run update.mjs check first, then take the current fingerprint.');
    target = W('next', 'fingerprints-current.json');
  }
  writeFileSync(target, JSON.stringify(fp));
  const inc = fp.incomplete.length ? ` ${fp.incomplete.length} item(s) could not be checked in time and count as unknown.` : '';
  console.log(`Fingerprint saved as ${as}: ${Object.keys(fp.screens).length} screens, ${Object.keys(fp.components || {}).length} components, ${Object.keys(fp.variables || {}).length} variables.${inc}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
if (cmd === 'conflicts') {
  if (!existsSync(W('next', 'plan.json'))) fail('There is no pending update: run update.mjs check first.');
  const plan = readJson(W('next', 'plan.json'));
  if (!existsSync(W('fingerprints.json'))) {
    const msg = 'No baseline fingerprint yet (the first update after installing this version, or it was never taken): hand edits in Figma cannot be detected this time. Ask the user whether they edited the file by hand since the last update. After this update the baseline is recorded.';
    writeFileSync(W('next', 'conflicts.json'), JSON.stringify({ baseline: false, conflicts: [], kept: [], unknown: [] }, null, 1));
    console.log(msg);
    process.exit(0);
  }
  if (!existsSync(W('next', 'fingerprints-current.json'))) fail('Take the current fingerprint first: update.mjs fp-script, run the scripts, update.mjs fp-read <dir> --as current.');
  const base = readJson(W('fingerprints.json'));
  const cur = readJson(W('next', 'fingerprints-current.json'));
  const incomplete = new Set(cur.incomplete || []);
  const touchesScreen = (s) => {
    if ((plan.removed || []).includes(s)) return 'deletes it (it left the flows)';
    if (plan.full || (plan.recapture || []).includes(s)) return 'recaptures it (light and dark frames are rebuilt)';
    if ((plan.patch || []).includes(s)) return 'adjusts layers in place';
    if ((plan.retag || []).includes(s)) return 'renames and re-tags layers in place';
    return null;
  };
  const conflicts = [], kept = [], unknown = [];
  for (const [s, b] of Object.entries(base.screens || {})) {
    const c = cur.screens?.[s];
    if (!c) { unknown.push({ kind: 'screen', name: titleOf(s), why: incomplete.has(s) ? 'not checked in time' : 'not fingerprinted' }); continue; }
    for (const k of ['frame', 'dark']) {
      if (!b[k]) continue;
      let edit = null;
      if (c[k] === null || c[k] === undefined) edit = 'deleted in Figma';
      else if (c[k].h !== b[k].h) edit = `edited in Figma (${c[k].n - b[k].n >= 0 ? '+' : ''}${c[k].n - b[k].n} layers)`;
      if (!edit) continue;
      const item = { kind: k === 'dark' ? 'dark screen' : 'screen', name: titleOf(s), edit };
      const act = touchesScreen(s);
      if (act) conflicts.push({ ...item, update: act });
      else kept.push({ ...item, update: 'not touched: the edit stays' });
    }
  }
  const norm = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');
  const touchedComps = new Set([...(plan.componentsTouched || []), ...(plan.lookChanged || [])].map(norm));
  if (base.components && cur.components) {
    for (const [id, b] of Object.entries(base.components)) {
      const c = cur.components[id];
      if (incomplete.has('component:' + id)) { unknown.push({ kind: 'component', name: b.name, why: 'not checked in time' }); continue; }
      let edit = null;
      if (!c) edit = 'deleted in Figma';
      else if (c.h !== b.h) edit = c.name !== b.name ? `renamed to "${c.name}" and/or edited` : 'edited in Figma';
      if (!edit) continue;
      const item = { kind: 'component', name: b.name, edit };
      const hit = plan.full || touchedComps.has(norm(b.name.split(/[ /,=]/)[0]));
      if (hit) conflicts.push({ ...item, update: plan.full ? 'rebuilds every component (full rebuild)' : 'adds variants or rebuilds it' });
      else kept.push({ ...item, update: 'not rebuilt: the edit stays (loose values may be re-linked to variables)' });
    }
    for (const [id, c] of Object.entries(cur.components)) if (!base.components[id]) kept.push({ kind: 'component', name: c.name, edit: 'added by hand', update: 'not touched' });
  }
  const tokenTouched = new Set([...(plan.tokens?.changed || []), ...(plan.tokens?.removed || [])].map(norm));
  if (base.variables && cur.variables) {
    for (const [name, h] of Object.entries(base.variables)) {
      const c = cur.variables[name];
      let edit = null;
      if (c === undefined) edit = 'deleted in Figma';
      else if (c !== h) edit = 'value edited in Figma';
      if (!edit) continue;
      const bare = norm(name.split('/').slice(1).join('/'));
      const item = { kind: 'variable', name, edit };
      if (tokenTouched.has(bare)) conflicts.push({ ...item, update: 'sets it to the prototype\'s new value' });
      else kept.push({ ...item, update: 'not touched' });
    }
  }
  writeFileSync(W('next', 'conflicts.json'), JSON.stringify({ baseline: true, conflicts, kept, unknown }, null, 1));
  const out = ['# Edits made in Figma since the last update', ''];
  out.push(conflicts.length
    ? `**${conflicts.length} conflict(s)**: edits the update would overwrite. Decide each one before applying (keep the edit and skip that item, or let the update overwrite it).\n\n${table(['What', 'Name', 'Edit in Figma', 'The update'], conflicts.map((c) => [c.kind, c.name, c.edit, c.update]))}`
    : 'No conflicts: the update does not touch anything that was edited by hand.');
  out.push('');
  if (kept.length) out.push(`Edits the update leaves alone (${kept.length}):\n\n${table(['What', 'Name', 'Edit in Figma', 'The update'], kept.map((c) => [c.kind, c.name, c.edit, c.update]))}`, '');
  if (unknown.length) out.push(`Not checked (${unknown.length}): ${unknown.map((u) => `${u.name} (${u.why})`).join(', ')}.`, '');
  console.log(out.join('\n'));
  process.exit(conflicts.length ? 2 : 0);
}

// ---------------------------------------------------------------------------------------------
const baselineItems = () => [...new Set(['state.json', state.source || 'orig.html', 'figma.html', 'tokens.json', state.adapter, state.flows, 'fingerprints.json', state.maps, state.shots].filter(Boolean))];

function backup(reason, extra = {}) {
  const name = stamp();
  const to = W('backups', name);
  mkdirSync(to, { recursive: true });
  const saved = [];
  for (const it of baselineItems()) {
    if (!existsSync(W(it))) continue;
    cpSync(W(it), path.join(to, it), { recursive: true });
    saved.push(it);
  }
  writeFileSync(path.join(to, 'backup.json'), JSON.stringify({ createdAt: new Date().toISOString(), reason, sourceSha: state.sourceSha, items: saved, ...extra }, null, 1));
  return { name, dir: to, saved };
}

// keeps the newest backups; called only after a command finished, so nothing it still needs goes
function prune() {
  for (const old of listBackups().slice(KEEP_BACKUPS)) rmSync(W('backups', old.name), { recursive: true, force: true });
}

function listBackups() {
  if (!existsSync(W('backups'))) return [];
  return readdirSync(W('backups'))
    .filter((n) => existsSync(W('backups', n, 'backup.json')))
    .map((n) => ({ name: n, ...readJson(W('backups', n, 'backup.json')) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function restore(name) {
  const from = W('backups', name);
  const meta = readJson(path.join(from, 'backup.json'));
  for (const it of meta.items) {
    rmSync(W(it), { recursive: true, force: true });
    cpSync(path.join(from, it), W(it), { recursive: true });
  }
  // items that did not exist at backup time must not survive the restore
  for (const it of baselineItems()) if (!meta.items.includes(it) && it !== 'state.json') rmSync(W(it), { recursive: true, force: true });
  return meta;
}

if (cmd === 'backups') {
  const all = listBackups();
  if (!all.length) { console.log('No backups yet.'); process.exit(0); }
  console.log(table(['Backup', 'Reason', 'Source'], all.map((b) => [b.name, b.reason, (b.sourceSha || '').slice(0, 12)])));
  process.exit(0);
}

if (cmd === 'promote') {
  const force = rest.includes('--force');
  if (!existsSync(W('next', 'plan.json'))) fail('Nothing to promote: there is no pending update (update.mjs check first).');
  const audits = ['gen', 'gen-late'].map((g) => W('next', g, 'audit')).filter((d) => existsSync(d));
  if (!audits.length) fail('The update has not been applied yet (no next/gen/audit). Apply it and run the audit before promoting.');
  const failed = [];
  let checked = 0;
  for (const a of audits) {
    const results = path.join(a, 'results');
    if (!existsSync(results) || !readdirSync(results).some((f) => f.endsWith('.json'))) {
      if (a === W('next', 'gen', 'audit')) fail(`No audit results in ${results}. Run the audit scripts and save each result there before promoting.`);
      continue;   // the late path is optional: no results means it was not used
    }
    checked++;
    const r = spawnSync(process.execPath, [path.join(here, 'audit.mjs'), 'report', dir, a], { encoding: 'utf8' });
    if (r.status !== 0) failed.push({ audit: path.relative(dir, a), output: (r.stdout || '') + (r.stderr || '') });
  }
  if (!checked) fail('No audit results found for this update. Run the audit and save its results before promoting.');
  if (failed.length && !force) {
    for (const f of failed) console.log(`Audit ${f.audit} FAILED:\n${f.output.trim()}\n`);
    fail('Not promoted: the audit has failures. Fix their cause and audit again. Only if the user explicitly accepts these failures, run promote again with --force.', 3);
  }
  const b = backup('before promote', failed.length ? { forced: true, auditFailures: failed.map((f) => f.audit) } : {});
  // the pending update's own data survives a failed promote too
  const r = spawnSync(process.execPath, [path.join(here, 'sync.mjs'), 'promote', dir], { encoding: 'utf8' });
  if (r.status !== 0) {
    restore(b.name);
    fail(`Promote failed and the local baseline was restored from backup ${b.name}.\n${(r.stderr || r.stdout || '').trim()}`);
  }
  prune();
  console.log(`Promoted. Backup of the previous baseline: backups/${b.name}${failed.length ? ' (promoted with audit failures, accepted by the user)' : ''}.`);
  console.log('Next: take the new baseline fingerprint (update.mjs fp-script, run the scripts, update.mjs fp-read <dir> --as baseline).');
  process.exit(0);
}

if (cmd === 'rollback') {
  const all = listBackups();
  if (!all.length) fail('There are no backups to restore.');
  const name = rest[0] || all[0].name;
  if (!all.some((b) => b.name === name)) fail(`No backup named ${name}. Available: ${all.map((b) => b.name).join(', ')}`);
  const safety = backup('before rollback');
  if (existsSync(W('next'))) renameSync(W('next'), path.join(safety.dir, 'next'));
  const meta = restore(name);
  prune();
  console.log(`Local baseline restored from backup ${name} (${meta.reason}). The state before the rollback is in backups/${safety.name}.`);
  console.log('Figma was not changed: to undo changes in the file, use Figma\'s version history (File → Show version history).');
  process.exit(0);
}

fail(USAGE);
