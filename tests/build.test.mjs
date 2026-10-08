// node --test tests/*.test.mjs — the first build: page and section setup, capture reconciliation and the
// first `sync.mjs detect` (no baseline yet). Everything runs on synthetic data in a temporary folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const S = path.join(here, '..', 'skills', 'proto-handoff', 'scripts');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'proto-handoff-build-'));
const node = (script, args, env = {}) => spawnSync(process.execPath, [path.join(S, script), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const json = (f) => JSON.parse(readFileSync(f, 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function project(name, lang = 'en') {
  const cfg = path.join(tmp, `${name}.jsonc`);
  writeFileSync(cfg, JSON.stringify({ workRoot: path.join(tmp, 'projects'), docsLanguage: lang }));
  const proto = path.join(tmp, `${name}.html`);
  writeFileSync(proto, '<!doctype html><html></html>');
  const env = { PROTO_HANDOFF_CONFIG: cfg };
  const r = node('init-project.mjs', [name, proto], env);
  assert.equal(r.status, 0, r.stderr);
  return { dir: path.join(tmp, 'projects', name), env };
}

test('pages-script also finds or creates the capture section, named in the docs language', () => {
  const { dir, env } = project('pages', 'es');
  const r = node('init-project.mjs', ['pages-script', dir], env);
  assert.equal(r.status, 0, r.stderr);
  const code = readFileSync(path.join(dir, 'gen', '00-pages.js'), 'utf8');
  assert.doesNotThrow(() => new AsyncFunction('figma', code));
  assert.match(code, /createSection\(\)/);
  assert.match(code, /"Pantallas nuevas"/);
  assert.match(code, /section: section\.id/);
});

test('set-pages stores the section with the pages and rejects a bad id', () => {
  const { dir, env } = project('setpages');
  const pages = { cover: '0:1', foundations: '1:2', components: '1:3', screens: '1:4', flows: '1:5' };
  let r = node('init-project.mjs', ['set-pages', dir, JSON.stringify({ pages, section: '6:2' })], env);
  assert.equal(r.status, 0, r.stderr);
  const state = json(path.join(dir, 'state.json'));
  assert.deepEqual(state.pages, pages);
  assert.equal(state.section, '6:2');
  r = node('init-project.mjs', ['set-pages', dir, JSON.stringify({ pages, section: 'nope' })], env);
  assert.notEqual(r.status, 0);
});

test('reconcile-captures reads the find-captures result and keeps the newest frame per screen', () => {
  const d = path.join(tmp, 'rec');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'jobs.json'), JSON.stringify([{ screen: 'a/home' }, { screen: 'a/list' }, { screen: 'a/gone' }]));
  // find-captures: the first frame in page order is in `captures`, later ones in `duplicates`
  writeFileSync(path.join(d, 'scan.json'), JSON.stringify({
    captures: { 'a/home': '7:2', 'a/list': '8:2', 'b/other': '9:2' },
    duplicates: { 'a/home': ['12:4'] }, untagged: [], count: 3,
  }));
  const out = path.join(d, 'nodes.json');
  const r = node('reconcile-captures.mjs', [path.join(d, 'scan.json'), path.join(d, 'jobs.json'), out]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(json(out), { 'a/home': '12:4', 'a/list': '8:2' });
  const res = JSON.parse(r.stdout);
  assert.deepEqual(res.missing, [3]);
  assert.deepEqual(res.dup, ['7:2']);
});

test('reconcile-captures still reads a plain { screen: [ids] } scan', () => {
  const d = path.join(tmp, 'rec-plain');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'jobs.json'), JSON.stringify([{ screen: 'a/home' }]));
  writeFileSync(path.join(d, 'scan.json'), JSON.stringify({ 'a/home': ['3:9', '3:12'] }));
  const out = path.join(d, 'nodes.json');
  const r = node('reconcile-captures.mjs', [path.join(d, 'scan.json'), path.join(d, 'jobs.json'), out]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(json(out), { 'a/home': '3:12' });
});

test('reconcile-captures never wipes a table that has captures with a scan that matches nothing', () => {
  const d = path.join(tmp, 'rec-empty');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'jobs.json'), JSON.stringify([{ screen: 'a/home' }]));
  writeFileSync(path.join(d, 'scan.json'), JSON.stringify({ captures: {}, duplicates: {}, untagged: [], count: 0 }));
  const out = path.join(d, 'nodes.json');
  writeFileSync(out, JSON.stringify({ 'a/home': '7:2' }));
  const r = node('reconcile-captures.mjs', [path.join(d, 'scan.json'), path.join(d, 'jobs.json'), out]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /left as it was/);
  assert.deepEqual(json(out), { 'a/home': '7:2' });
});

function auditDir(name, { screens = {}, planFrames = null } = {}) {
  const d = path.join(tmp, name);
  mkdirSync(path.join(d, 'map'), { recursive: true });
  writeFileSync(path.join(d, 'adapter.json'), JSON.stringify({ components: [{ ui: 'Button', sel: '.btn', kind: 'atom', stage: 'Actions' }] }));
  writeFileSync(path.join(d, 'state.json'), JSON.stringify({ adapter: 'adapter.json', maps: 'map', screens,
    pages: { cover: '0:1', foundations: '1:2', components: '1:3', screens: '1:4', flows: '1:5' } }));
  writeFileSync(path.join(d, 'map', '01-a_home.json'), JSON.stringify({ screen: 'a/home', nodes: [
    { r: [0, 0, 100, 100], d: 0, name: 'root' }, { r: [10, 10, 20, 10], d: 1, ui: 'Button', name: 'Button' }] }));
  if (planFrames) { mkdirSync(path.join(d, 'next'), { recursive: true }); writeFileSync(path.join(d, 'next', 'plan.json'), JSON.stringify({ frames: planFrames })); }
  return d;
}

test('audit: a first build audits the screens still waiting in next/plan.json', () => {
  const d = auditDir('audit-first', { planFrames: { 'a/home': { frame: '7:2' } } });
  const out = path.join(d, 'audit');
  const r = node('audit.mjs', ['prepare', d, path.join(d, 'map'), out]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).screens, 1);
  assert.deepEqual(json(path.join(out, 'expect.json')), { screens: ['7:2'], unframed: [] });
});

test('audit: the report fails when a screen of the maps was not audited', () => {
  const d = auditDir('audit-gap');
  const out = path.join(d, 'audit');
  assert.equal(node('audit.mjs', ['prepare', d, path.join(d, 'map'), out]).status, 0);
  mkdirSync(path.join(out, 'results'), { recursive: true });
  writeFileSync(path.join(out, 'results', 'A1-components.json'), JSON.stringify({ checks: [{ id: 'inventory', ok: true }] }));
  const r = node('audit.mjs', ['report', d, out]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /covers every screen of the maps \| FAIL/);
  assert.match(r.stdout, /a\/home: no frame known/);
});

test('stages: the Components boards follow the canonical order, other names after', async () => {
  const { LANGS, orderStages } = await import('../skills/proto-handoff/scripts/lib/labels.mjs');
  assert.deepEqual(orderStages(LANGS.es, ['Chat', 'Mi tablero', 'Navegación', 'Estructura de la app', 'Chat']),
    ['Estructura de la app', 'Navegación', 'Chat', 'Mi tablero']);
  // a name in the other language is still recognized
  assert.deepEqual(orderStages(LANGS.en, ['Identity', 'Navegación', 'App structure']), ['App structure', 'Navegación', 'Identity']);
});
