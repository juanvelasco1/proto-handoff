#!/usr/bin/env node
// Reads every CSS custom property declared on :root, resolves it in each theme
// and classifies it (color, dimension, font, other). Output feeds build-variables.
//
//   node extract-tokens.mjs <prototype.html|url> [--themes light,dark] [--out tokens.json]
import { writeFileSync } from 'node:fs';
import { openPage } from './lib/browser.mjs';

const args = process.argv.slice(2);
const src = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const themes = opt('--themes', 'light,dark').split(',');
const out = opt('--out', 'tokens.json');
if (!src) { console.error('usage: extract-tokens.mjs <prototype> [--themes light,dark] [--out tokens.json]'); process.exit(1); }

const { browser, page } = await openPage(src);

const result = await page.evaluate((themes) => {
  // Names declared on :root in any same-origin stylesheet, in source order.
  const names = [];
  const seen = new Set();
  const walk = (rules) => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) walk(r.cssRules);
      if (!r.style || !r.selectorText || !/(^|,)\s*(:root|html)\b/.test(r.selectorText)) continue;
      for (const p of r.style) if (p.startsWith('--') && !seen.has(p)) { seen.add(p); names.push(p); }
    }
  };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch (e) { /* cross-origin */ } }

  // Resolve any CSS color (oklch, color-mix, var chains) to sRGB through a canvas pixel.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0';
  document.body.appendChild(probe);
  const toRgba = (value) => {
    probe.style.color = '';
    probe.style.color = value;
    if (!probe.style.color) return null;
    const computed = getComputedStyle(probe).color;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000'; cx.fillStyle = computed;
    cx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
    return { r: r / 255, g: g / 255, b: b / 255, a: +(a / 255).toFixed(3), css: computed };
  };
  const toPx = (value) => {
    probe.style.width = '';
    probe.style.width = value;
    if (!probe.style.width) return null;
    return parseFloat(getComputedStyle(probe).width);
  };

  const raw = {};
  const html = document.documentElement;
  const before = html.getAttribute('data-theme');
  for (const t of themes) {
    html.setAttribute('data-theme', t);
    const cs = getComputedStyle(html);
    raw[t] = Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
  }
  if (before === null) html.removeAttribute('data-theme'); else html.setAttribute('data-theme', before);

  const tokens = [];
  for (const n of names) {
    const first = raw[themes[0]][n];
    const entry = { name: n, raw: Object.fromEntries(themes.map((t) => [t, raw[t][n]])) };
    if (/^-?[\d.]+(px|rem|em)$/.test(first) || /^0$/.test(first)) {
      entry.type = 'dimension';
      entry.values = Object.fromEntries(themes.map((t) => { html.setAttribute('data-theme', t); return [t, toPx(raw[t][n])]; }));
    } else if (/font|family/i.test(n) && /,|sans|serif|mono/.test(first)) {
      entry.type = 'fontFamily';
      entry.values = Object.fromEntries(themes.map((t) => [t, raw[t][n].split(',')[0].replace(/['"]/g, '').trim()]));
    } else if (CSS.supports('color', first) && !/^-?[\d.]+%?$/.test(first)) {
      entry.type = 'color';
      entry.values = Object.fromEntries(themes.map((t) => { html.setAttribute('data-theme', t); return [t, toRgba(raw[t][n])]; }));
    } else {
      entry.type = 'other';
    }
    tokens.push(entry);
  }
  if (before === null) html.removeAttribute('data-theme'); else html.setAttribute('data-theme', before);
  probe.remove();
  return { themes, tokens };
}, themes);

await browser.close();

const counts = result.tokens.reduce((a, t) => ((a[t.type] = (a[t.type] || 0) + 1), a), {});
const themed = result.tokens.filter((t) => t.type === 'color' &&
  JSON.stringify(t.values[themes[0]]) !== JSON.stringify(t.values[themes[themes.length - 1]])).length;
writeFileSync(out, JSON.stringify({ source: src, ...result }, null, 2));
console.log(JSON.stringify({ out, counts, colorsThatChangeWithTheme: themed }));
