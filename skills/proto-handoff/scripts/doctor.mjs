#!/usr/bin/env node
// Preflight: checks what this computer can do before the skill starts, and says how to fix
// what is missing. Nothing is changed, except a test file written and removed in the work root.
//
//   node doctor.mjs            human-readable report
//   node doctor.mjs --json     the same, as JSON (for the agent)
//   node doctor.mjs --offline  skip the network check
//
// It cannot see the AI tool's own tools: the agent checks separately that the Figma MCP tools
// (use_figma, generate_figma_design) are available. Exit code 1 when a blocking check fails.
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigError, configPath } from './lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const asJson = process.argv.includes('--json');
const offline = process.argv.includes('--offline');
const checks = [];
// level: ok | fail (blocks everything) | warn (works, with a limit) | info
const add = (id, level, detail, fix = null) => checks.push({ id, level, detail, fix });

// 1. Node
const major = +process.versions.node.split('.')[0];
if (major >= 18) add('node', 'ok', `Node ${process.versions.node}`);
else add('node', 'fail', `Node ${process.versions.node} is too old`, 'Install Node 18 or newer (https://nodejs.org)');

// 2. npm dependencies
const require = createRequire(import.meta.url);
const missing = ['playwright-core', 'pngjs'].filter((m) => { try { require.resolve(m); return false; } catch { return true; } });
if (!missing.length) add('dependencies', 'ok', 'playwright-core and pngjs installed');
else add('dependencies', 'fail', `missing: ${missing.join(', ')}`, `Run once: cd "${here}" && npm install`);

// 3. config
let config = null;
try {
  const r = loadConfig();
  config = r.config;
  add('config', 'ok', r.exists ? `valid: ${r.file}` : `no config file, using defaults (create one with: node scripts/setup.mjs)`);
  for (const w of r.warnings) add('config', 'warn', w);
} catch (e) {
  if (!(e instanceof ConfigError)) throw e;
  add('config', 'fail', e.problems.join('; '), `Edit ${e.file}`);
}

// 4. Chrome
if (!missing.length) {
  if (config?.browser.chromePath && !process.env.CHROME) process.env.CHROME = config.browser.chromePath;
  try {
    const { chromePath } = await import('./lib/browser.mjs');
    const exe = chromePath();
    try {
      const { chromium } = await import('playwright-core');
      const browser = await Promise.race([
        chromium.launch({ executablePath: exe, headless: true }),
        new Promise((_, no) => setTimeout(() => no(new Error('Chrome did not start within 30 s')), 30000)),
      ]);
      await browser.close();
      add('chrome', 'ok', exe);
    } catch (e) {
      add('chrome', 'fail', `found ${exe} but it did not start: ${e.message.split('\n')[0]}`, 'Update Chrome, or set browser.chromePath in the config to another Chrome/Chromium');
    }
  } catch (e) {
    add('chrome', 'fail', e.message, 'Install Google Chrome or Chromium, or set browser.chromePath in the config (or the CHROME environment variable)');
  }
} else add('chrome', 'info', 'not checked until the dependencies are installed');

// 5. port and work root
if (config) {
  const port = config.server.port;
  const free = await new Promise((ok) => {
    const s = net.createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true)));
    s.listen(port, '127.0.0.1');
  });
  if (free) add('port', 'ok', `127.0.0.1:${port} is free`);
  else add('port', 'warn', `127.0.0.1:${port} is in use (maybe the skill's server is already running)`, 'If it is another program, set server.port in the config');
  try {
    mkdirSync(config.workRoot, { recursive: true });
    const probe = path.join(config.workRoot, `.write-test-${process.pid}`);
    writeFileSync(probe, 'ok'); rmSync(probe);
    const tmp = /^(\/tmp|\/private\/tmp|\/var\/folders)\b/.test(config.workRoot);
    if (tmp) add('workRoot', 'warn', `${config.workRoot} is a temporary folder: the system deletes it`, 'Set workRoot to a folder in your home, such as ~/.proto-handoff/projects');
    else add('workRoot', 'ok', `${config.workRoot} is writable`);
  } catch (e) {
    add('workRoot', 'fail', `cannot write to ${config.workRoot}: ${e.code || e.message}`, 'Set workRoot in the config to a folder you can write to');
  }
}

// 6. Figma's capture script reachable (captures load it at run time; it is never bundled)
if (!offline) {
  try {
    const ctl = AbortSignal.timeout(8000);
    const res = await fetch('https://mcp.figma.com/mcp/html-to-design/capture.js', { method: 'GET', signal: ctl });
    if (res.ok) add('figma-capture', 'ok', 'Figma capture script reachable');
    else add('figma-capture', 'warn', `Figma capture script answered ${res.status}`, 'Captures may fail: check your network or proxy; analysis-only mode still works');
    await res.body?.cancel?.();
  } catch (e) {
    add('figma-capture', 'warn', `cannot reach mcp.figma.com (${e.name === 'TimeoutError' ? 'timeout' : e.message})`, 'Captures need internet access to Figma; analysis-only mode still works');
  }
}

// 7. optional: Python for audit-visual.py (pixel diff images); the core does not need it
try {
  execFileSync('python3', ['-c', 'import PIL, numpy'], { stdio: 'ignore' });
  add('python (optional)', 'ok', 'python3 with Pillow and numpy: audit-visual.py available');
} catch {
  add('python (optional)', 'info', 'python3 with Pillow and numpy not found: only audit-visual.py (optional red-diff images) is unavailable');
}

const blocking = checks.filter((c) => c.level === 'fail');
const summary = {
  ready: !blocking.length,
  config: configPath(),
  mode: blocking.length ? 'blocked' : 'local checks passed: full mode if the Figma MCP tools are available, otherwise analysis-only',
  agentMustCheck: 'Figma MCP server tools use_figma and generate_figma_design in your own tool list; writing to Figma needs a Full seat and edit access to the file',
  checks,
};
if (asJson) { console.log(JSON.stringify(summary, null, 1)); process.exit(blocking.length ? 1 : 0); }

const mark = { ok: '✓', fail: '✗', warn: '!', info: '·' };
console.log('proto-handoff preflight\n');
for (const c of checks) {
  console.log(`${mark[c.level]} ${c.id.padEnd(18)} ${c.detail}`);
  if (c.fix && c.level !== 'ok') console.log(`  ${''.padEnd(18)} fix: ${c.fix}`);
}
console.log(`\n${blocking.length ? `Not ready: ${blocking.length} blocking problem(s) above.` : 'Local checks passed.'}`);
console.log('Also needed (checked by the agent, not here): the Figma MCP tools use_figma and generate_figma_design,');
console.log('and a Figma Full seat with edit access to the file. Without them the skill runs in analysis-only mode.');
process.exit(blocking.length ? 1 : 0);
