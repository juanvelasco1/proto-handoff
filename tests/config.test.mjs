// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, DEFAULTS, ConfigError, stripJsonc, projectSettings } from '../skills/proto-handoff/scripts/lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = path.join(here, '..', 'skills', 'proto-handoff', 'config.example.jsonc');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'proto-handoff-config-'));
const write = (name, text) => { const f = path.join(tmp, name); writeFileSync(f, text); return f; };

test('a missing file means all defaults', () => {
  const r = loadConfig({ file: path.join(tmp, 'nope.jsonc') });
  assert.equal(r.exists, false);
  assert.equal(r.config.server.port, DEFAULTS.server.port);
  assert.equal(r.config.docsLanguage, 'en');
});

test('the documented example equals the defaults', () => {
  const { config } = loadConfig({ file: example });
  const d = structuredClone(DEFAULTS);
  d.workRoot = config.workRoot;
  assert.deepEqual(config, d);
});

test('comments, trailing commas and // inside strings', () => {
  const s = stripJsonc('{\n // c\n "a": "http://x//y", /* b */ "b": [1,2,],\n}');
  assert.deepEqual(JSON.parse(s), { a: 'http://x//y', b: [1, 2] });
});

test('invalid values stop with every problem listed', () => {
  const f = write('bad.jsonc', '{ "docsLanguge": "es", "server": { "port": 80 }, "style": { "title": "red" }, "outputs": { "darkScreens": "no" }, "audit": { "minScreenPct": 120 } }');
  assert.throws(() => loadConfig({ file: f }), (e) => {
    assert.ok(e instanceof ConfigError);
    const all = e.problems.join('\n');
    assert.match(all, /unknown setting "docsLanguge" \(did you mean "docsLanguage"\?\)/);
    assert.match(all, /"server.port" is 80/);
    assert.match(all, /"style.title" is "red"/);
    assert.match(all, /"outputs.darkScreens" is "no"/);
    assert.match(all, /"audit.minScreenPct" is 120/);
    return true;
  });
});

test('broken JSON reports the line', () => {
  const f = write('broken.jsonc', '{\n "server": { "port": 9000 }\n "x": 1\n}\n');
  assert.throws(() => loadConfig({ file: f }), /near line 3/);
});

test('low-contrast documentation colors warn but do not stop', () => {
  const f = write('warn.jsonc', '{ "style": { "subtle": "#9a9a9a" } }');
  const r = loadConfig({ file: f });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /style.subtle/);
});

test('project settings follow the outputs', () => {
  const f = write('dark-off.jsonc', '{ "outputs": { "darkScreens": false }, "server": { "port": 9123 }, "docsLanguage": "es" }');
  const p = projectSettings(loadConfig({ file: f }).config);
  assert.deepEqual(p.themes, ['light']);
  assert.equal(p.baseUrl, 'http://127.0.0.1:9123/figma.html');
  assert.equal(p.options.docsLanguage, 'es');
  assert.equal(p.options.audit.minScreenPct, 90);
});
