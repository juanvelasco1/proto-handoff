#!/usr/bin/env node
// Reference screenshots of each route, the ground truth for the visual audit.
//   node shoot-routes.mjs <base-url-of-migrated.html> <screens.json|comma list> <out-dir> [--themes light,dark] [--width 1440] [--height 900]
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { chromePath } from './lib/browser.mjs';
const args = process.argv.slice(2);
const [base, list, out] = args;
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const themes = opt('--themes', 'light').split(',');
const width = +opt('--width', 1440), height = +opt('--height', 900);
const screens = existsSync(list) ? Object.keys(JSON.parse(readFileSync(list, 'utf8'))) : list.split(',');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: chromePath() });
for (const theme of themes) for (const s of screens) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${base}#/${s}?theme=${theme}`);
  await page.waitForSelector('html[data-ui-ready=true]', { timeout: 30000 });
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' });
  await page.waitForTimeout(500);
  const file = path.join(out, `${theme}_${s.replace(/\//g, '_')}.png`);
  await page.screenshot({ path: file });
  console.log(file);
  await ctx.close();
}
await browser.close();
