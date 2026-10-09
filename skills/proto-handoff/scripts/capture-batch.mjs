#!/usr/bin/env node
// For each screen: open its route, dump the DOM map (what every captured layer is), resolve
// which on-screen element leads to which other screen, then push that exact state to Figma.
// Dumping and capturing from the same page load is what lets post-processing trust the map.
//
//   node capture-batch.mjs <base-url-of-migrated.html> <jobs.json> <out-dir> [--theme light]
//        [--width 1440] [--height 900] [--no-capture] [--only 9,10] [--trim .table-row:120]
//
// --only: capture just those job numbers (1-based) while still mapping every screen, to retry
// the captures that failed without re-submitting the ones already in Figma.
// --only-open: with --only, open just those screens (no map for the rest; use a scratch
// out-dir). For chunked captures: a capture id expires (410 CAPTURE_EXPIRED) minutes
// after it is issued, so ids are requested per chunk, right before the chunk runs.
//
// jobs.json: [{ "screen": "main-flow/inbox", "captureId": "…" }, …]
// Writes <out-dir>/<n>-<slug>.json per screen and <out-dir>/links.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { chromePath } from './lib/browser.mjs';

const args = process.argv.slice(2);
const [baseUrl, jobsFile, outDir] = args;
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const theme = opt('--theme', 'light');
const width = +opt('--width', 1440);
const height = +opt('--height', 900);
const noCapture = args.includes('--no-capture');
const tag = !args.includes('--no-tag');   // layer identity travels in aria-labels (see tagForCapture)
const only = opt('--only') ? new Set(opt('--only').split(',').map(Number)) : null;
const onlyOpen = only && args.includes('--only-open');
// --trim .table-row:120 — a list too long for the capture service (a 279-row table never converted)
// keeps its first rows; the map is dumped from the same trimmed page, so the census agrees
const trim = opt('--trim');
mkdirSync(outDir, { recursive: true });

const jobs = JSON.parse(readFileSync(jobsFile, 'utf8'));
const browser = await chromium.launch({ executablePath: chromePath() });
const captureJs = noCapture ? '' : await (await fetch('https://mcp.figma.com/mcp/html-to-design/capture.js')).text();

async function openRoute(screen) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`${baseUrl}#/${screen}?theme=${theme}`);
  await page.waitForSelector('html[data-ui-ready=true]', { timeout: 30000 });
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}' });
  await page.waitForTimeout(500);
  if (trim) {
    const [sel, keep] = trim.split(':');
    await page.evaluate(([s, k]) => { const seen = new Map(); for (const el of document.querySelectorAll(s)) { const p = el.parentElement; seen.set(p, (seen.get(p) || 0) + 1); if (seen.get(p) > k) el.remove(); } }, [sel, +keep || 100]);
  }
  return { ctx, page };
}

// Everything a post-processor needs to name layers and wire the prototype, keyed by rect.
const DUMP = () => {
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0;
  };
  // the text a slot shows: a part hidden by CSS is not on the screen (a person tile holds the first
  // name and the full name, one of them display:none; textContent read "AnaAna Smith" and
  // the slot check wrote it into 14 tiles). innerText would also apply text-transform
  const txt = (e) => {
    if (!e) return '';
    let s = '';
    const w = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) s += c.textContent; else if (c.nodeType === 1) { const cs = getComputedStyle(c); if (cs.display !== 'none' && cs.visibility !== 'hidden') w(c); } } };
    w(e);
    // whole sentences: verify-slots writes this text into the instance (cut at 80, a card's
    // description lost its last words)
    return s.replace(/\s+/g, ' ').trim().slice(0, 400);
  };
  const out = [];
  const walk = (e, depth) => {
    for (const k of e.children) {
      if (/^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(k.tagName) || k.closest('svg') && k.tagName !== 'svg') continue;
      // opacity 0 hides the whole subtree (a child can't be more opaque than its parent) and the
      // capture drops it: hover-only actions are not on the screen at rest
      if (!vis(k)) { if (getComputedStyle(k).opacity !== '0') walk(k, depth); continue; }
      const r = k.getBoundingClientRect();
      const n = { r: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10), d: depth };
      if (k.dataset.ui) {
        n.ui = k.dataset.ui;
        if (k.dataset.uiProps) n.props = k.dataset.uiProps;
        const slots = {};
        k.querySelectorAll('[data-ui-slot]').forEach((s) => { if (s.closest('[data-ui]') === k) slots[s.dataset.uiSlot] = txt(s); });
        if (Object.keys(slots).length) n.slots = slots;
      }
      // a box that paints nothing and holds nothing (a transparent click-catcher) never reaches a
      // capture: the census does not expect it on screen
      if (!k.children.length && !txt(k)) {
        const ps = getComputedStyle(k);
        const paints = (ps.backgroundColor !== 'rgba(0, 0, 0, 0)' && ps.backgroundColor !== 'transparent') || ps.backgroundImage !== 'none' ||
          ps.boxShadow !== 'none' || ['Top', 'Right', 'Bottom', 'Left'].some((sd) => parseFloat(ps['border' + sd + 'Width']) > 0 && ps['border' + sd + 'Style'] !== 'none');
        if (!paints && k.tagName !== 'IMG' && k.tagName !== 'svg' && k.tagName !== 'INPUT' && k.tagName !== 'TEXTAREA') n.blank = true;
      }
      if (k.dataset.uiSection) n.section = k.dataset.uiSection;
      if (k.dataset.uiNavType) n.nav = k.dataset.uiNavType;
      if (k.tagName === 'svg') n.icon = k.getAttribute('data-ui-icon') || true;
      if (k.tagName === 'IMG') n.img = true;
      const label = k.getAttribute('aria-label');
      if (label) n.label = label.slice(0, 80);
      // a box that scrolls (or clips) shows only its own size of its content: Figma clips it too
      const cs = getComputedStyle(k);
      const sy = /(auto|scroll)/.test(cs.overflowY) && k.scrollHeight > k.clientHeight + 4;
      const sx = /(auto|scroll)/.test(cs.overflowX) && k.scrollWidth > k.clientWidth + 4;
      if (sx || sy) {
        n.scroll = (sx ? 'x' : '') + (sy ? 'y' : '');
        // the scrollbar takes room in the browser and none in Figma: content there is up to this
        // much wider (the geometry audit allows it)
        const sb = k.offsetWidth - k.clientWidth - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0);
        if (sb > 0) n.sb = sb;
      }
      else if (/(hidden|clip)/.test(cs.overflowX + cs.overflowY) && (k.scrollHeight > k.clientHeight + 4 || k.scrollWidth > k.clientWidth + 4)) n.clip = true;
      // every class: the component inventory reads them (name keeps only the first)
      if (k.classList.length > 1) n.cls = [...k.classList].join(' ');
      // chrome: a box with its own background, border, corners or shadow is a visible container
      const ch = [];
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) || cs.backgroundImage !== 'none') ch.push('bg');
      if (['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none')) ch.push('bd');
      if (parseFloat(cs.borderTopLeftRadius) > 0) ch.push('r');
      if (cs.boxShadow !== 'none') ch.push('sh');
      if (ch.length) n.ch = ch.join(',');
      if (/^(flex|inline-flex|grid|inline-grid)$/.test(cs.display)) n.lay = cs.display.replace('inline-', '') + (cs.display.includes('flex') ? ':' + cs.flexDirection : '');
      // text aligned right or centered inside its own box: the capture makes the text layer as wide
      // as the glyphs, at the box's left, so the box width travels here (fix-text-boxes.js)
      if (/^(right|end|center)$/.test(cs.textAlign) && [...k.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) {
        n.ta = cs.textAlign === 'center' ? 'c' : 'r';
        n.pad = [parseFloat(cs.paddingLeft) || 0, parseFloat(cs.paddingRight) || 0];
        n.tx = [...k.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      }
      n.name = k.dataset.ui || k.dataset.uiSection || k.id || (k.classList[0] || k.tagName.toLowerCase());
      // the look of its own text (size, weight, tracking, case, style, family): sync tells a
      // restyled label (one that lost its capitals in a box of the same size) from a data edit
      if ([...k.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) {
        n.ts = [cs.fontSize, cs.fontWeight, cs.letterSpacing, cs.textTransform, cs.fontStyle, cs.fontFamily.split(',')[0]].join('/');
      }
      out.push(n);
      if (k.tagName !== 'svg') walk(k, depth + 1);
    }
  };
  walk(document.body, 0);
  return out;
};

// Resolve a recipe statement to the element it would click, without clicking.
const TARGET = (stmt) => {
  const Q = (s) => document.querySelector(s);
  // a deferred step is the step itself: setTimeout(function(){ C(…); }, 2600)
  const late = stmt.match(/^setTimeout\(\s*function\s*\(\)\s*\{\s*([\s\S]*?);?\s*\}\s*,\s*\d+\s*\)$/);
  if (late) stmt = late[1].trim();
  // typing into a field: the field is the hotspot (a click on it stands for the typed query)
  const ty = stmt.match(/^TYPE\((.*)\)$/s);
  if (ty) stmt = `C(${JSON.stringify(Function(`return [${ty[1]}]`)()[0])})`;
  // document.querySelectorAll('x')[i].dispatchEvent(…) / .click(): the i-th match
  const qa = stmt.match(/^document\.querySelectorAll\((['"])(.*?)\1\)\[(\d+)\]\./s);
  if (qa) stmt = `CN(${JSON.stringify(qa[2])}, ${qa[3]})`;
  // a SCROLL step has no element to click: the gesture is on the box that scrolls to it
  const sc = stmt.match(/^SCROLL\((.*)\)$/s);
  if (sc) {
    let e = Q(Function(`return ${sc[1]}`)());
    while (e && e !== document.body) {
      const cs = getComputedStyle(e);
      if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4) break;
      e = e.parentElement;
    }
    if (!e || e === document.body) e = document.scrollingElement;
    const b = e.getBoundingClientRect();
    const x = Math.max(0, b.x), y = Math.max(0, b.y);
    const w = Math.min(innerWidth, b.right) - x, h = Math.min(innerHeight, b.bottom) - y;
    if (w < 1 || h < 1) return null;
    return { r: [x, y, w, h].map((v) => Math.round(v * 10) / 10), ui: null, label: null, gesture: 'scroll' };
  }
  const m = stmt.match(/^(C|CN|CTXT)\((.*)\)$/s);
  if (!m) return null;
  const a = Function(`return [${m[2]}]`)();
  let e = null;
  if (m[1] === 'C') e = Q(a[0]);
  if (m[1] === 'CN') e = document.querySelectorAll(a[0])[a[1]];
  if (m[1] === 'CTXT') e = [...document.querySelectorAll(a[0])].find((x) => (x.textContent || '').replace(/\s+/g, ' ').includes(a[1]));
  if (!e) return null;
  const r = e.getBoundingClientRect();
  if (r.width < 1) return null;
  return { r: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10), ui: e.dataset.ui || null, label: e.getAttribute('aria-label') };
};

const split = (recipe) => (recipe || '').split(/;(?=\s*(?:[A-Za-z_$]|$))/).map((s) => s.trim()).filter(Boolean);

let manifest, adapterScreens;
const links = [];
let i = 0;
const uploads = [];
for (const job of jobs) {
  i++;
  if (onlyOpen && !only.has(i)) continue;
  const { ctx, page } = await openRoute(job.screen);
  if (!manifest) {
    manifest = JSON.parse(await page.evaluate(() => document.getElementById('ui-manifest').textContent));
    adapterScreens = await page.evaluate(() => window.__UI_ADAPTER__.screens);
  }
  // a box scrolled sideways (a timeline scrolled to today) goes back to x = 0 before anything is
  // measured: the map, the links and the capture see one scroll state (tagForCapture resets
  // again right before the capture). The reset's scroll events fire at the next frame: two frames
  // let a page that reacts to scroll (lazy rows, a shadow on a sticky column) answer before the
  // map is measured, as it has by the capture. A plain wait with a runtime older than __uiResetScroll
  await page.evaluate(() => {
    if (window.__uiResetScroll) window.__uiResetScroll();
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  const nodes = await page.evaluate(DUMP);
  const mine = split(adapterScreens[job.screen].recipe);
  // Which element on this screen leads to which other screen. Three rules, strongest first:
  //  flow   — T's recipe is this recipe plus one step: that step's element leads to T, exactly.
  //  next   — T follows this screen in a flow: the first step where T's recipe diverges from
  //           this one is the gesture that starts the way there (verified later by clicking).
  //  global — T is one step from the root (rail, global nav): reachable from anywhere.
  const pairs = [];
  for (const f of manifest.flows) {
    for (let k = 0; k + 1 < f.steps.length; k++) {
      if (f.steps[k].screen === job.screen) pairs.push({ to: f.steps[k + 1].screen, via: f.steps[k + 1].via, flow: f.id });
    }
  }
  for (const t of jobs) {
    if (t.screen === job.screen) continue;
    const theirs = split(adapterScreens[t.screen].recipe);
    let common = 0;
    while (common < mine.length && common < theirs.length && mine[common] === theirs[common]) common++;
    const extends1 = common === mine.length && theirs.length === mine.length + 1;
    const next = pairs.find((p) => p.to === t.screen);
    const global = theirs.length === 1 && mine.length > 0;
    const kind = extends1 ? 'flow' : next ? 'next' : global ? 'global' : null;
    if (!kind || common >= theirs.length) continue;
    const stmt = theirs[kind === 'global' ? 0 : common];
    const target = await page.evaluate(TARGET, stmt);
    if (target) links.push({ from: job.screen, to: t.screen, kind, stmt, via: next ? next.via : null, ...target });
    else if (next) links.push({ from: job.screen, to: t.screen, kind: 'unresolved', stmt, via: next.via });
  }
  const slug = job.screen.replace(/[^a-z0-9]+/gi, '_');
  const file = path.join(outDir, `${String(i).padStart(2, '0')}-${slug}.json`);
  writeFileSync(file, JSON.stringify({ screen: job.screen, title: adapterScreens[job.screen].title, theme, size: [width, height], nodes }));
  let status = 'skipped', deferred = false;
  if (!noCapture && (!only || only.has(i))) {
    if (tag) {
      const mineLinks = links.filter((l) => l.from === job.screen && l.r).map((l) => ({ x: l.r[0] + l.r[2] / 2, y: l.r[1] + l.r[3] / 2, w: l.r[2], h: l.r[3], to: l.to + (l.gesture ? '~' + l.gesture : '') }));
      await page.evaluate((ls) => window.__UI_CONTRACT__.tagForCapture(ls), mineLinks);
    }
    await page.evaluate((s) => { const el = document.createElement('script'); el.textContent = s; document.head.appendChild(el); }, captureJs);
    await page.waitForTimeout(400);
    const endpoint = `https://mcp.figma.com/mcp/capture/${job.captureId}/submit?bindVariables=true`;
    const isSubmit = (r) => r.url().startsWith(endpoint.split('?')[0]);
    const started = page.waitForRequest(isSubmit, { timeout: 120000 });
    await page.evaluate(({ captureId, endpoint }) => { window.figma.captureForDesign({ captureId, endpoint, selector: 'body' }); }, { captureId: job.captureId, endpoint });
    // The upload's response is often never surfaced to the page (the old wait for it timed out
    // at 180 s on every job while Figma had the capture). Wait for the request to leave and
    // finish, at most 30 s, then move on: polling the captureId is what confirms the capture.
    status = await started.then(async (req) => {
      // closing the page aborts an upload still on its way: the page stays open until the request
      // leaves for good (at most 3 minutes), while the next screens go on
      deferred = true;
      uploads.push(Promise.race([
        page.waitForEvent('requestfinished', { predicate: (r) => r === req, timeout: 180000 }),
        page.waitForEvent('requestfailed', { predicate: (r) => r === req, timeout: 180000 }),
      ]).catch(() => null).then(() => ctx.close().catch(() => null)));
      const done = await Promise.race([
        page.waitForEvent('requestfinished', { predicate: (r) => r === req, timeout: 30000 }).then(async () => {
          // a finished request can still be a refusal (expired id, payload too large): say so
          const res = await req.response();
          if (!res || res.ok()) return 'sent';
          let why = ''; try { why = (await res.text()).slice(0, 200); } catch (e) {}
          return `failed: ${res.status()} ${why}`;
        }, () => null),
        page.waitForEvent('requestfailed', { predicate: (r) => r === req, timeout: 30000 }).then(() => 'failed: upload', () => null),
      ]);
      return done || 'sent (unconfirmed)';
    }, (e) => `failed: ${e.name}`);
  }
  console.log(JSON.stringify({ n: i, screen: job.screen, nodes: nodes.length, status }));
  if (!deferred) await ctx.close();
}
await Promise.all(uploads);
writeFileSync(path.join(outDir, 'links.json'), JSON.stringify(links, null, 1));
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify({ done: jobs.length, links: links.length }));
await browser.close();
