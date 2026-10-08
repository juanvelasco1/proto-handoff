// node --test tests/ — the safety net of updates: conflicts, the audit gate, backups, rollback,
// project init. Everything runs on synthetic data in a temporary folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fill } from '../skills/proto-handoff/scripts/lib/fill.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const S = path.join(here, '..', 'skills', 'proto-handoff', 'scripts');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'proto-handoff-update-'));
const node = (script, args, env = {}) => spawnSync(process.execPath, [path.join(S, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function workDir(name) {
  const d = path.join(tmp, name);
  mkdirSync(path.join(d, 'next'), { recursive: true });
  mkdirSync(path.join(d, 'map'), { recursive: true });
  writeFileSync(path.join(d, 'map', '01-home.json'), '{"nodes":[]}');
  writeFileSync(path.join(d, 'orig.html'), '<html>v1</html>');
  writeFileSync(path.join(d, 'state.json'), JSON.stringify({
    source: 'orig.html', sourceSha: 'abc', adapter: 'adapter.json', flows: 'bands.json', baseUrl: 'http://127.0.0.1:8777/figma.html',
    maps: 'map', shots: 'shots', pages: { components: '1:3' },
    screens: { home: { frame: '2:1', dark: '2:2' }, list: { frame: '3:1', dark: '3:2' }, detail: { frame: '4:1' } },
  }));
  return d;
}
const fp = (screens, components, variables) => ({ takenAt: 'x', screens, components, variables, missing: [], incomplete: [] });

test('conflicts: an edited screen the update recaptures is a conflict; an edited one it leaves is kept', () => {
  const d = workDir('conflicts');
  writeFileSync(path.join(d, 'next', 'plan.json'), JSON.stringify({ recapture: ['home'], patch: [], retag: [], removed: [],
    tokens: { added: [], changed: ['--accent'], removed: [] }, componentsTouched: ['Avatar'], lookChanged: [] }));
  const base = fp({ home: { frame: { h: 'a', n: 10 }, dark: { h: 'b', n: 10 } }, list: { frame: { h: 'c', n: 5 } }, detail: { frame: { h: 'd', n: 5 } } },
    { '10:1': { name: 'Avatar', h: 'x', n: 2 }, '10:2': { name: 'InboxRow', h: 'y', n: 4 } }, { 'Tokens/accent': '1', 'Tokens/bg-surface': '2' });
  const cur = structuredClone(base);
  cur.screens.home.frame = { h: 'EDIT', n: 12 };         // recaptured → conflict
  cur.screens.list.frame = { h: 'EDIT', n: 5 };          // untouched → kept
  cur.screens.detail.frame = null;                       // deleted by hand, untouched → kept
  cur.components['10:1'].h = 'EDIT';                     // touched → conflict
  cur.components['10:2'].h = 'EDIT';                     // not touched → kept
  cur.variables['Tokens/accent'] = 'EDIT';               // token changes → conflict
  writeFileSync(path.join(d, 'fingerprints.json'), JSON.stringify(base));
  writeFileSync(path.join(d, 'next', 'fingerprints-current.json'), JSON.stringify(cur));
  const r = node('update.mjs', ['conflicts', d]);
  assert.equal(r.status, 2, r.stderr);
  const c = json(path.join(d, 'next', 'conflicts.json'));
  assert.deepEqual(c.conflicts.map((x) => `${x.kind}:${x.name}`).sort(), ['component:Avatar', 'screen:home', 'variable:Tokens/accent']);
  assert.deepEqual(c.kept.map((x) => `${x.kind}:${x.name}:${x.edit}`).sort(), ['component:InboxRow:edited in Figma', 'screen:detail:deleted in Figma', 'screen:list:edited in Figma (+0 layers)']);
});

test('conflicts: without a baseline it says so and does not fail', () => {
  const d = workDir('nobaseline');
  writeFileSync(path.join(d, 'next', 'plan.json'), JSON.stringify({ recapture: [], tokens: { added: [], changed: [], removed: [] } }));
  const r = node('update.mjs', ['conflicts', d]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /No baseline fingerprint yet/);
});

test('promote refuses without audit results and changes nothing', () => {
  const d = workDir('gate');
  writeFileSync(path.join(d, 'next', 'plan.json'), JSON.stringify({ sourceSha: 'def' }));
  const before = readFileSync(path.join(d, 'state.json'), 'utf8');
  let r = node('update.mjs', ['promote', d]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not been applied yet/);
  mkdirSync(path.join(d, 'next', 'gen', 'audit', 'results'), { recursive: true });
  r = node('update.mjs', ['promote', d]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No audit results/);
  assert.equal(readFileSync(path.join(d, 'state.json'), 'utf8'), before);
  assert.equal(existsSync(path.join(d, 'backups')), false);
});

test('rollback restores the local baseline and keeps the state it replaced', () => {
  const d = workDir('rollback');
  const b = path.join(d, 'backups', '2026-01-01_000000');
  mkdirSync(path.join(b, 'map'), { recursive: true });
  writeFileSync(path.join(b, 'orig.html'), '<html>v0</html>');
  writeFileSync(path.join(b, 'map', '01-home.json'), '{"nodes":[1]}');
  writeFileSync(path.join(b, 'state.json'), JSON.stringify({ ...json(path.join(d, 'state.json')), sourceSha: 'old' }));
  writeFileSync(path.join(b, 'backup.json'), JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', reason: 'before promote', sourceSha: 'old', items: ['state.json', 'orig.html', 'map'] }));
  const r = node('update.mjs', ['rollback', d]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(json(path.join(d, 'state.json')).sourceSha, 'old');
  assert.equal(readFileSync(path.join(d, 'orig.html'), 'utf8'), '<html>v0</html>');
  assert.equal(existsSync(path.join(d, 'next')), false, 'the pending update is moved into the safety backup');
  const list = node('update.mjs', ['backups', d]).stdout;
  assert.match(list, /before rollback/);
});

test('fingerprint scripts are read-only and parse', () => {
  const code = fill('fingerprint.js', { screens: [{ screen: 'home', frame: '2:1', dark: null }], componentsPage: '1:3', variables: true, budgetMs: 1000 });
  assert.doesNotThrow(() => new AsyncFunction('figma', code));
  for (const verb of ['.remove(', 'createPage', 'appendChild', '.name =', 'setPluginData', 'setSharedPluginData']) assert.ok(!code.includes(verb), `fingerprint must not call ${verb}`);
});

test('init-project: creates the work folder from the config and refuses to overwrite it', () => {
  const cfg = path.join(tmp, 'cfg.jsonc');
  writeFileSync(cfg, JSON.stringify({ workRoot: path.join(tmp, 'projects'), viewport: { width: 390, height: 844 }, docsLanguage: 'es' }));
  const proto = path.join(tmp, 'p.html');
  writeFileSync(proto, '<!doctype html><html></html>');
  const env = { PROTO_HANDOFF_CONFIG: cfg };
  let r = node('init-project.mjs', ['demo', proto], env);
  assert.equal(r.status, 0, r.stderr);
  const state = json(path.join(tmp, 'projects', 'demo', 'state.json'));
  assert.equal(state.width, 390);
  assert.equal(state.options.docsLanguage, 'es');
  r = node('init-project.mjs', ['demo', proto], env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already exists/);
  r = node('init-project.mjs', ['set-file', path.join(tmp, 'projects', 'demo'), 'https://www.figma.com/board/KEY0000000000/x'], env);
  assert.notEqual(r.status, 0);
});
