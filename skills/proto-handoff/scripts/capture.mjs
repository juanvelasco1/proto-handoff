#!/usr/bin/env node
// Pushes one state of a prototype into Figma through Figma's html-to-design capture.
// The capture gives pixel-exact geometry, auto layout and variable bindings (when the
// file already holds variables whose WEB code syntax is `var(--token)`).
//
//   node capture.mjs <http-url> <captureId> [--steps steps.js] [--theme dark]
//                    [--width 1440] [--height 900] [--selector body] [--storage '{"k":"v"}']
//
// The URL must be http(s): the capture posts to mcp.figma.com and file:// origins are refused.
// --steps: a JS file evaluated in the page after load (clicks, typing) to reach the state.
import { readFileSync } from 'node:fs';
import { openPage } from './lib/browser.mjs';

const args = process.argv.slice(2);
const [url, captureId] = args;
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
if (!url || !captureId) { console.error('usage: capture.mjs <http-url> <captureId> [options]'); process.exit(1); }

const width = +opt('--width', 1440);
const height = +opt('--height', 900);
const theme = opt('--theme');
const selector = opt('--selector', 'body');
const stepsFile = opt('--steps');
const storage = opt('--storage') ? JSON.parse(opt('--storage')) : undefined;

const { browser, context, page } = await openPage(url, { width, height, theme, storage });
try {
  if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  if (stepsFile) {
    await page.evaluate(readFileSync(stepsFile, 'utf8'));
    await page.waitForTimeout(600);
  }
  const res = await context.request.get('https://mcp.figma.com/mcp/html-to-design/capture.js');
  await page.evaluate((s) => { const el = document.createElement('script'); el.textContent = s; document.head.appendChild(el); }, await res.text());
  await page.waitForTimeout(500);
  const endpoint = `https://mcp.figma.com/mcp/capture/${captureId}/submit?bindVariables=true`;
  // captureForDesign resolves only when its toolbar closes, so wait for the upload instead.
  const submitted = page.waitForResponse((r) => r.url().startsWith(endpoint.split('?')[0]), { timeout: 120000 });
  await page.evaluate(({ captureId, endpoint, selector }) => {
    window.figma.captureForDesign({ captureId, endpoint, selector });
  }, { captureId, endpoint, selector });
  const r = await submitted;
  console.log(JSON.stringify({ ok: r.ok(), status: r.status(), captureId }));
} finally {
  await browser.close();
}
