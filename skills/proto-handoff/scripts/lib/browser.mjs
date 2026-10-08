// Shared headless-Chrome helpers. Every script opens the prototype the same way:
// fixed viewport, motion off, deterministic clock, so two runs of the same state match.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadConfig, configPath } from './config.mjs';

// The CHROME environment variable wins; then the usual install paths of Chrome, Chromium and Edge
// (all Chromium, which is what the capture needs) on macOS, Linux and Windows.
const win = (base, rel) => (base ? path.join(base, rel) : null);
const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/microsoft-edge',
  win(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe'),
  win(process.env['PROGRAMFILES(X86)'], 'Google\\Chrome\\Application\\chrome.exe'),
  win(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
  win(process.env.PROGRAMFILES, 'Microsoft\\Edge\\Application\\msedge.exe'),
  win(process.env['PROGRAMFILES(X86)'], 'Microsoft\\Edge\\Application\\msedge.exe'),
].filter(Boolean);

// Order: the CHROME environment variable, then browser.chromePath from the user's config, then the
// usual install paths. A path that is set but does not exist is an error, not a silent fallback.
export function chromePath() {
  if (process.env.CHROME) {
    if (existsSync(process.env.CHROME)) return process.env.CHROME;
    throw new Error(`CHROME is set to ${process.env.CHROME}, which does not exist`);
  }
  const configured = loadConfig().config.browser.chromePath;
  if (configured) {
    if (existsSync(configured)) return configured;
    throw new Error(`browser.chromePath in ${configPath()} is ${configured}, which does not exist`);
  }
  const hit = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!hit) throw new Error('Chrome not found: install Chrome or Chromium, or set browser.chromePath in your config (or the CHROME environment variable)');
  return hit;
}

// Accepts a URL or a local file path.
export function toUrl(src) {
  if (/^https?:\/\//.test(src)) return src;
  return pathToFileURL(path.resolve(src)).href;
}

const NO_MOTION = `*,*::before,*::after{transition:none!important;animation:none!important;
  scroll-behavior:auto!important;caret-color:transparent!important}`;

// Frozen clock: prototypes that print "6 min ago" must print the same thing every run. Any fixed
// instant works; this one is kept so maps and shots stay comparable with earlier runs.
const FROZEN_NOW = Date.parse('2026-09-24T15:00:00Z');

export async function openPage(src, { width = 1440, height = 900, theme, storage, colorScheme } = {}) {
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: colorScheme || (theme === 'dark' ? 'dark' : 'light'),
    reducedMotion: 'reduce',
  });
  await context.addInitScript(({ now, storage }) => {
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [now])); }
      static now() { return now; }
    };
    Math.random = (() => { let s = 42; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; })();
    if (storage) for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
  }, { now: FROZEN_NOW, storage });
  const page = await context.newPage();
  await page.goto(toUrl(src));
  await page.addStyleTag({ content: NO_MOTION });
  await page.waitForTimeout(400);
  return { browser, context, page };
}

// Click helpers of the flow recipes (the same helpers a screenshot flow map uses): C(sel), CN(sel,n), CTXT(sel,text),
// TYPE(sel,value), HOV(sel), SCROLL(sel). A recipe is a string of calls separated by ';'.
export const HELPERS = `
window.Q=function(s){return document.querySelector(s);};
window.C=function(s){var e=Q(s); if(e) e.dispatchEvent(new MouseEvent('click',{bubbles:true})); return e;};
window.CN=function(s,n){var e=document.querySelectorAll(s)[n]; if(e) e.dispatchEvent(new MouseEvent('click',{bubbles:true})); return e;};
window.CTXT=function(s,t){var l=document.querySelectorAll(s);for(var i=0;i<l.length;i++){if((l[i].textContent||'').replace(/\\s+/g,' ').indexOf(t)>=0){l[i].dispatchEvent(new MouseEvent('click',{bubbles:true}));return l[i];}}return null;};
window.TYPE=function(s,v){var e=Q(s); if(!e)return; var p=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value'); if(p&&p.set){p.set.call(e,v);}else{e.value=v;} e.dispatchEvent(new Event('input',{bubbles:true}));};
window.HOV=function(s){var e=Q(s); if(e) e.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));};
window.SCROLL=function(s){var e=Q(s); if(e) e.scrollIntoView({block:'start'});};
`;

export function splitRecipe(recipe) {
  return (recipe || '').split(/;(?=\s*(?:[A-Za-z_$]|$))/).map((s) => s.trim()).filter(Boolean);
}

// Plays a recipe one call at a time with a pause, so each click lands on the re-rendered DOM.
export async function runRecipe(page, recipe, pause = 180) {
  await page.evaluate(HELPERS);
  for (const stmt of splitRecipe(recipe)) {
    await page.evaluate(stmt);
    await page.waitForTimeout(pause);
  }
  await page.waitForTimeout(300);
}
