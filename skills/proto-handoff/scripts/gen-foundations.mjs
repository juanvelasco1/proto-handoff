#!/usr/bin/env node
// Builds the Foundations page scripts from what the prototype really uses:
//   tokens.json      → color by role, semantic colors, WCAG contrast of text pairs (per mode)
//   type census      → text styles (one per size/weight/tracking/case in use), h1–h6, scale
//   the page's CSS   → spacing scale (gap/padding/margin values) and its coverage, density
// Every topic is one script (foundation-board.js filled with a board spec) and a report of the
// completeness audit for the stage, so gaps are shown instead of silently skipped.
//
//   node gen-foundations.mjs <work-dir> <out-dir> [--census type-census.json] [--state state.json]
// work-dir holds tokens.json and figma.html; state.json gives pages.foundations.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelsFor } from './lib/labels.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [work, outDir] = process.argv.slice(2);
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const W = (f) => path.join(work, f);
const { themes, tokens } = JSON.parse(readFileSync(W('tokens.json'), 'utf8'));
const state = JSON.parse(readFileSync(opt('state', W('state.json')), 'utf8'));
// every text written on the boards comes from the project's docs language (lib/labels.mjs)
const L = labelsFor(state).foundations;
const DEC = labelsFor(state).decimal;
const TOPIC = L.topics;
// the census is read from Figma (census-type.js); without it the type board is skipped
const censusFile = opt('census', W('type-census.json'));
const census = existsSync(censusFile) ? JSON.parse(readFileSync(censusFile, 'utf8')) : { frames: 0, looks: [] };
const html = readFileSync(W('figma.html'), 'utf8');
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const MODES = themes.map((t) => t[0].toUpperCase() + t.slice(1));
const fill = (params) => readFileSync(path.join(here, 'figma', 'foundation-board.js'), 'utf8')
  .replace(/\/\*PARAMS\*\/[\s\S]*?\/\*END\*\//, JSON.stringify(params));
const audit = [];
const check = (topic, item, ok, note) => audit.push({ topic, item, ok, note });
const fmt = (n) => String(Math.round(n * 100) / 100).replace('.', DEC);

// ---------------------------------------------------------------------------------- color ---
const name = (t) => t.name.replace(/^--/, '');
const colors = tokens.filter((t) => t.type === 'color');
const opaque = (t) => themes.every((th) => t.values[th] && t.values[th].a === 1);
// role by name (internal keys; L.semantic gives the label); the semantic families come first so
// late-ink is "error", not "text"
const SEMANTIC = [['error', /^(late|today|error|danger|negative|critical|destructive)/], ['warning', /^(doing|warn|caution)/],
  ['success', /^(ok|success|positive)/], ['info', /^(done|info|s-unread|notice)/]];
// the soft (background) member of a semantic family: `-soft` in some systems, `-subtle` or `-bg` in others
const SOFT = /soft|subtle|tint|weak|-bg$/;
const semanticOf = (n) => (SEMANTIC.find(([, re]) => re.test(n)) || [])[0];
const CATS = [
  ['brand', (n) => /^(app|brand)-|^(accent|primary)(-|$)/.test(n)],
  ['shadow', (n) => /^shadow/.test(n)],
  ['semantic', (n) => !!semanticOf(n)],
  ['text', (n) => /^(fg|muted|text)$|ink$|^on-|^(text|fg|foreground)-/.test(n)],
  ['borders', (n) => /border|edge|line|divider|stroke|outline/.test(n)],
  ['states', (n) => /press|sel|hi$|focus|hover|active/.test(n)],
  ['surfaces', () => true],
];
const catOf = (n) => CATS.find(([, f]) => f(n))[0];
const CAT_NOTE = L.catNote;
const LV = L.levels;
const lum = ({ r, g, b }) => { const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const has = (n) => colors.some((t) => name(t) === n);
const tok = (n) => colors.find((t) => name(t) === n);
// Role tokens. The first name in each list is the naming the pipeline was first tuned on; the others
// cover the handoff-ready contract (--text-primary, --bg-surface…) and common conventions. A role no
// token fills falls back to a token of its category, so no board binds a variable that is missing.
const ROLE_NAMES = {
  fg: ['fg', 'text', 'text-primary', 'foreground', 'ink', 'text-default'],
  muted: ['muted', 'text-secondary', 'text-muted', 'fg-muted', 'muted-foreground', 'text-subtle'],
  bg: ['bg', 'bg-canvas', 'background', 'canvas', 'bg-default', 'page'],
  surface: ['surface', 'bg-surface', 'card', 'panel', 'surface-1', 'bg-elevated'],
  fill: ['fill', 'bg-surface-sunken', 'bg-subtle', 'bg-muted', 'surface-2', 'field'],
  border: ['border', 'border-subtle', 'line', 'divider', 'border-default', 'stroke'],
  rail: ['rail', 'sidebar', 'bg-sidebar', 'nav', 'bg-nav'],
};
const inCat = (cat) => colors.filter((t) => catOf(name(t)) === cat && opaque(t)).map(name);
const ROLE = Object.fromEntries(Object.entries(ROLE_NAMES).map(([r, l]) => [r, l.find(has) || null]));
ROLE.fg = ROLE.fg || inCat('text').find((n) => !/on-/.test(n)) || inCat('text')[0] || null;
ROLE.muted = ROLE.muted || inCat('text').find((n) => n !== ROLE.fg && !/on-/.test(n)) || ROLE.fg;
ROLE.bg = ROLE.bg || inCat('surfaces')[0] || null;
ROLE.surface = ROLE.surface || ROLE.bg;
ROLE.fill = ROLE.fill || ROLE.surface;
ROLE.border = ROLE.border || inCat('borders')[0] || ROLE.muted;
ROLE.rail = ROLE.rail || ROLE.surface;
const cv = (r) => 'color/' + (ROLE[r] || r);
const semRoles = Object.fromEntries(SEMANTIC.map(([r]) => [r, colors.map(name).filter((n) => semanticOf(n) === r)]));
const badgeTone = (r) => {
  const pick = (role) => { const l = semRoles[role]; const soft = l.find((n) => SOFT.test(n)); const ink = l.find((n) => /ink/.test(n)) || l.find((n) => !SOFT.test(n)); return soft && ink ? { bg: 'color/' + soft, fg: 'color/' + ink } : { bg: cv('fill'), fg: cv('fg') }; };
  return r >= 4.5 ? pick('info') : r >= 3 ? pick('warning') : pick('error');
};
const level = (r, text) => (text ? (r >= 7 ? LV.aaa : r >= 4.5 ? LV.aa : r >= 3 ? LV.aaLarge : LV.fail) : (r >= 3 ? LV.aaUi : LV.fail));

// the contrast pairs: the names the pipeline was tuned on when the prototype uses them, otherwise
// the text and surface tokens it has (text-on-accent is for accent grounds, not these)
const legacyInks = ['fg', 'muted', 'rail-ink'].filter(has);
const legacyGrounds = ['bg', 'surface', 'rail', 'field', 'fill', 'sel', 'row-sel', 'lift'].filter(has);
const uniq = (l) => [...new Set(l.filter(Boolean))];
const inks = legacyInks.length ? legacyInks : uniq([ROLE.fg, ROLE.muted, ...inCat('text').filter((n) => !/on-/.test(n))]).slice(0, 5);
const grounds = legacyGrounds.length ? legacyGrounds : uniq([ROLE.bg, ROLE.surface, ROLE.fill, ...inCat('surfaces').filter((n) => /^(bg|surface)/.test(n))]).slice(0, 6);
const pairs = [];
for (const f of inks) for (const b of grounds) pairs.push([f, b, true]);
for (const [role, l] of Object.entries(semRoles)) {
  const inkL = l.filter((n) => /ink$/.test(n) || !SOFT.test(n));
  const soft = l.find((n) => SOFT.test(n));
  for (const i of inkL) { if (soft && /ink$/.test(i)) pairs.push([i, soft, true]); if (ROLE.bg) pairs.push([i, ROLE.bg, /ink$/.test(i)]); }
}
for (const a of colors.map(name).filter((n) => /^app-/.test(n))) if (has('on-app')) pairs.push(['on-app', a, true]);
const contrast = pairs.filter(([f, b]) => opaque(tok(f)) && opaque(tok(b))).map(([f, b, text]) => {
  const by = Object.fromEntries(themes.map((th, i) => { const r = ratio(tok(f).values[th], tok(b).values[th]); return [MODES[i], { r, l: level(r, text) }]; }));
  return { f, b, text, by };
});
const fails = contrast.filter((c) => Object.values(c.by).some((x) => x.l === LV.fail || (c.text && x.l === LV.aaLarge)));

const colorBlocks = [
  { k: 'title', text: TOPIC.color, sub: L.colorSub(colors.length) },
];
// shown from the base of the interface up; CATS order is only for classifying
const SHOW = ['surfaces', 'text', 'borders', 'states', 'semantic', 'brand', 'shadow'];
for (const cat of SHOW) {
  const l = colors.filter((t) => catOf(name(t)) === cat);
  if (!l.length) continue;
  colorBlocks.push({ k: 'h2', text: L.cats[cat], sub: CAT_NOTE[cat], req: 'color-cat' });
  colorBlocks.push({ k: 'swatches', req: 'color-swatches', items: l.map((t) => ({ v: 'color/' + name(t), note: cat === 'semantic' ? L.semantic[semanticOf(name(t))] : `var(${t.name})` })) });
}
colorBlocks.push({ k: 'h2', text: L.semanticTitle, sub: L.semanticSub, req: 'color-semantic' });
colorBlocks.push({ k: 'table', req: 'color-semantic', widths: [180, 260, 260, 400], head: L.semanticHead,
  rows: Object.entries(semRoles).map(([role, l]) => {
    const soft = l.find((n) => SOFT.test(n)); const ink = l.filter((n) => !SOFT.test(n));
    const gap = !l.length ? L.semanticGap.none : !soft ? L.semanticGap.soft : !ink.length ? L.semanticGap.ink : L.semanticGap.ok;
    return [L.semantic[role], soft ? { sw: 'color/' + soft } : '—', ink.length ? { sw: 'color/' + ink[0], label: ink.join(', ') } : '—', gap];
  }) });
for (const [role, l] of Object.entries(semRoles)) {
  const soft = l.some((n) => SOFT.test(n)), ink = l.some((n) => !SOFT.test(n));
  check(TOPIC.color, L.checkSemantic(L.semantic[role]), soft && ink, soft && ink ? L.semanticNote.ok : !l.length ? L.semanticNote.none : !soft ? L.semanticNote.soft : L.semanticNote.ink);
}
colorBlocks.push({ k: 'h2', text: L.contrastTitle, sub: L.contrastSub, req: 'color-contrast' });
colorBlocks.push({ k: 'table', req: 'color-contrast', widths: [300, 170, 170, 170, 300], head: L.contrastHead,
  rows: contrast.map((c) => [`${c.f} / ${c.b}`, { pair: ['color/' + c.f, 'color/' + c.b] },
    { m: Object.fromEntries(Object.entries(c.by).map(([m, x]) => [m, fmt(x.r) + ':1'])) },
    { badge: Object.fromEntries(Object.entries(c.by).map(([m, x]) => [m, x.l])) },
    c.text ? L.useText : L.useIndicator]) });
check(TOPIC.color, L.checkPalette, ['surfaces', 'text', 'borders', 'states'].every((c) => colors.some((t) => catOf(name(t)) === c)), CATS.map(([c]) => `${L.cats[c]}: ${colors.filter((t) => catOf(name(t)) === c).length}`).join(' · '));
check(TOPIC.color, L.checkContrast, contrast.length > 0 && !fails.length, `${L.contrastNote(contrast.length, fails.length)}${fails.length ? ': ' + fails.map((c) => `${c.f}/${c.b} (${Object.entries(c.by).map(([m, x]) => m + ' ' + fmt(x.r)).join(', ')})`).join('; ') : ''}`);
check(TOPIC.color, L.checkPrimitives, true, L.primitivesNote);

// ----------------------------------------------------------------------------------- type ---
const MIN_USES = 20;
const WEIGHT = { Thin: 100, 'Extra Light': 200, Light: 300, Regular: 400, Medium: 500, 'Semi Bold': 600, Bold: 700, 'Extra Bold': 800, Black: 900 };
const groups = new Map();
for (const [k, n] of census.looks) {
  const [family, style, size, lh, ls, textCase] = k.split('|');
  const g = [family, style, +size, +ls, textCase].join('|');
  if (!groups.has(g)) groups.set(g, { family, style, size: +size, ls: +ls, textCase, n: 0, lhs: {} });
  const o = groups.get(g); o.n += n; o.lhs[lh] = (o.lhs[lh] || 0) + n;
}
const lead = (size, lh) => (lh === 'auto' ? 'auto' : lh / size <= 1.34 ? 'tight' : lh / size >= 1.55 ? 'relaxed' : 'normal');
const roleOf = (g) => (g.textCase === 'UPPER' ? 'Overline' : g.size >= 18 ? 'Title' : g.style === 'Semi Bold' || g.style === 'Bold' || (g.size >= 14 && g.style !== 'Regular') ? 'Heading'
  : g.size >= 12.5 ? 'Body' : g.size >= 11.5 ? 'Caption' : 'Label');
const kept = [...groups.values()].filter((g) => g.n >= MIN_USES).sort((a, b) => b.size - a.size || WEIGHT[b.style] - WEIGHT[a.style]);
const outliers = [...groups.values()].filter((g) => g.n < MIN_USES);
const textStyles = [];
for (const g of kept) {
  const lhs = Object.entries(g.lhs).filter(([lh]) => lh !== 'auto').sort((a, b) => b[1] - a[1]);
  const main = lhs[0];
  const alts = lhs.slice(1).filter(([, n]) => n >= Math.max(50, g.n * 0.1));
  const variants = [main, ...alts];
  for (const [lh, n] of variants) {
    const cls = lead(g.size, +lh);
    // tracking only names a style when it tells two otherwise equal looks apart
    const twin = kept.some((o) => o !== g && o.size === g.size && o.style === g.style && roleOf(o) === roleOf(g));
    const base = `${roleOf(g)}/${fmt(g.size).replace(',', '.')} ${g.style}${twin && g.ls ? (g.ls > 0 ? ' wide' : ' narrow') : ''}`;
    // two leadings of the same class (11/15.9 and 11/17 are both "normal") are told apart by value
    const clash = variants.some(([o]) => o !== lh && lead(g.size, +o) === cls);
    const tag = clash && lh !== main[0] ? `${cls} ${fmt(+lh)}` : cls;
    textStyles.push({ name: variants.length > 1 && tag !== 'normal' ? `${base} · ${tag}` : base, family: g.family, style: g.style, size: g.size, lh: +lh, ls: g.ls, textCase: g.textCase,
      uses: n, description: L.styleDesc(n, g.size, lh, WEIGHT[g.style], g.ls), role: roleOf(g) });
  }
}
const headings = textStyles.filter((s) => (s.role === 'Title' || s.role === 'Heading') && !/·/.test(s.name)).slice(0, 6);
const families = [...new Set(census.looks.map(([k]) => k.split('|')[0]))];
const fontStack = (tokens.find((t) => t.type === 'fontFamily') || { values: {} }).values[themes[0]] || '';
const sizes = [...new Set(kept.map((g) => g.size))].sort((a, b) => b - a);
const weights = [...new Set(kept.map((g) => g.style))];
const totalUses = census.looks.reduce((s, [, n]) => s + n, 0);
const covered = textStyles.reduce((s, x) => s + x.uses, 0);
const typeBlocks = !textStyles.length ? [] : [
  { k: 'title', text: TOPIC.type, sub: L.typeSub(census.frames, textStyles.length, Math.round((covered / totalUses) * 100)) },
  { k: 'h2', text: L.family, sub: `CSS: ${fontStack}`, req: 'type-family' },
  { k: 'table', req: 'type-family', widths: [260, 520, 300], head: L.familyHead,
    rows: families.map((f) => [f, { style: textStyles[0].name, text: L.familySample }, weights.map((w) => `${w} ${WEIGHT[w]}`).join(' · ')]) },
  { k: 'h2', text: L.headingsTitle, sub: L.headingsSub, req: 'type-headings' },
  { k: 'table', req: 'type-headings', widths: [80, 480, 300, 250], head: L.headingsHead,
    rows: headings.map((s, i) => ['h' + (i + 1), { style: s.name, text: L.headingSample }, s.name, `${fmt(s.size)}/${fmt(s.lh)} · ${WEIGHT[s.style]}`]) },
  { k: 'h2', text: L.scaleTitle, sub: L.scaleSub, req: 'type-scale' },
  { k: 'table', req: 'type-scale', widths: [300, 380, 200, 120, 110], head: L.scaleHead,
    rows: textStyles.map((s) => [s.name, { style: s.name, text: s.textCase === 'UPPER' ? L.upperSample : L.bodySample }, `${fmt(s.size)}/${fmt(s.lh)} · ${WEIGHT[s.style]}`, s.ls ? fmt(s.ls) + ' px' : '0', String(s.uses)]) },
];
if (outliers.length) typeBlocks.push({ k: 'p', muted: true, req: 'type-outliers', text: L.outliers(MIN_USES, outliers.map((g) => `${fmt(g.size)} ${g.style}${g.ls ? ' ' + fmt(g.ls) : ''} (${g.n})`).join(', ')) });
if (!census.looks.length) check(TOPIC.type, L.checkCensus, false, L.censusMissing);
else {
check(TOPIC.type, L.checkFamilies, families.length > 0, families.join(', ') + (fontStack ? ` · CSS ${fontStack.split(',')[0]}` : ''));
check(TOPIC.type, L.checkSizes, sizes.length >= 4, sizes.map(fmt).join(' · ') + ' px');
check(TOPIC.type, L.checkWeights, weights.length > 0, weights.join(', '));
check(TOPIC.type, L.checkLineHeight, textStyles.every((s) => s.lh > 0), L.lineHeightNote);
check(TOPIC.type, L.checkTracking, true, L.trackingNote(textStyles.filter((s) => s.ls).length));
check(TOPIC.type, L.checkStyles, headings.length >= 6 && ['Body', 'Caption', 'Label'].every((r) => textStyles.some((s) => s.role === r)),
  L.stylesNote(textStyles.length, headings.length));
check(TOPIC.type, L.checkCoverage, covered / totalUses >= 0.95, L.coverageNote(Math.round((covered / totalUses) * 1000) / 10, outliers.length));
}

// -------------------------------------------------------------------------------- spacing ---
const pxCount = {};
for (const m of css.matchAll(/(?:^|[;{\s])(?:gap|row-gap|column-gap|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?)\s*:\s*([^;}]+)/g)) {
  for (const v of m[1].matchAll(/(-?[\d.]+)px/g)) { const n = Math.abs(+v[1]); if (n > 0) pxCount[n] = (pxCount[n] || 0) + 1; }
}
const SCALE = [2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64];
const CORE = [4, 8, 16, 24, 32];
const scale = SCALE.filter((s) => pxCount[s] || CORE.includes(s));
const totalSp = Object.values(pxCount).reduce((a, b) => a + b, 0);
const inScale = scale.reduce((a, s) => a + (pxCount[s] || 0), 0);
const off = Object.entries(pxCount).filter(([v]) => !scale.includes(+v)).sort((a, b) => b[1] - a[1]);
const spaceVars = scale.map((s) => ({ name: `space/${s}`, value: s, scopes: ['GAP'], code: `${s}px`,
  description: L.spaceVarDesc(s, pxCount[s] || 0) }));
const dims = tokens.filter((t) => t.type === 'dimension' && !/^--r-/.test(t.name));
const DIM_NOTE = L.dimNote;
const row = parseFloat((dims.find((t) => t.name === '--row') || { values: {} }).values[themes[0]]) || 0;
const density = row ? (row <= 28 ? L.density.compact : row <= 36 ? L.density.medium : L.density.comfortable) : L.density.none;
const spaceBlocks = [
  { k: 'title', text: TOPIC.space, sub: L.spaceSub(totalSp, Math.round((inScale / totalSp) * 100)) },
  { k: 'h2', text: L.scale, req: 'space-scale' },
  { k: 'table', req: 'space-scale', widths: [160, 100, 500, 120], head: L.spaceHead,
    rows: scale.map((s) => [`space/${s}`, `${s} px`, { bar: `space/${s}`, px: s * 4 }, String(pxCount[s] || 0)]) },
  { k: 'p', muted: true, req: 'space-offscale', text: off.length ? L.offScale(off.map(([v, n]) => `${fmt(+v)} px (${n})`).join(', ')) : L.allInScale },
  { k: 'h2', text: L.densityTitle, sub: L.densitySub(density, row), req: 'space-density' },
  { k: 'table', req: 'space-density', widths: [220, 160, 300, 400], head: L.densityHead,
    rows: dims.map((t) => [`size/${name(t)}`, t.values[themes[0]], `var(${t.name})`, DIM_NOTE[t.name] || '—']) },
];
check(TOPIC.space, L.checkSpaceScale, scale.every((s) => s % 2 === 0), scale.join(' · ') + ' px');
check(TOPIC.space, L.checkSpaceTokens, spaceVars.length > 0, L.spaceTokensNote(spaceVars.length));
check(TOPIC.space, L.checkSpaceCoverage, inScale / totalSp >= 0.85, L.spaceCoverageNote(Math.round((inScale / totalSp) * 1000) / 10, off.map(([v, n]) => `${v}px×${n}`).join(', ')));
check(TOPIC.space, L.checkDensity, !!row, L.densityNote(density, row, (dims.find((t) => t.name === '--pad') || { values: {} }).values[themes[0]] || '—'));

// ------------------------------------------------------------------- stage 2: expression ---
const cssNC = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...cssNC.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
const decl = (prop) => rules.flatMap((r) => r.body.split(';').filter((d) => d.split(':')[0].trim() === prop).map((d) => ({ sel: r.sel, v: d.slice(d.indexOf(':') + 1).trim() })));
const dimOf = (n) => parseFloat((tokens.find((t) => t.name === n) || { values: {} }).values[themes[0]]) || 0;
const colorVar = (v) => { const m = /var\(--([a-z0-9-]+)\)/.exec(v); return m && has(m[1]) ? 'color/' + m[1] : null; };
const TOKENS_PAGE = state.pages.components;

// layout and grid
const media = [...cssNC.matchAll(/@media\s*\(([^)]*width[^)]*)\)/g)].map((m) => m[1]);
const bpq = media.map((m) => [m, parseFloat(m.replace(/[^0-9.]/g, ''))]).filter(([, b]) => b);
const bp = bpq.map(([, b]) => b);
const maxw = decl('max-width').filter((d) => /^\d+(px|ch)$/.test(d.v));
const containers = maxw.filter((d) => /px$/.test(d.v) && parseFloat(d.v) >= 400).sort((a, b) => parseFloat(b.v) - parseFloat(a.v));
const measures = [...new Set(maxw.filter((d) => /ch$/.test(d.v)).map((d) => d.v))].sort((a, b) => parseFloat(a) - parseFloat(b));
const gridCols = Object.entries(decl('grid-template-columns').reduce((o, d) => ((o[d.v] = (o[d.v] || 0) + 1), o), {})).sort((a, b) => b[1] - a[1]);
const railW = dimOf('--rail-w'), railMin = dimOf('--rail-min'), paneW = dimOf('--pane-w'), pad = dimOf('--pad');
const W0 = state.width || 1440, H0 = state.height || 900;
const gridStyles = [
  railW && { name: L.grid.open, description: L.gridDesc.open(railW), grids: [{ pattern: 'COLUMNS', alignment: 'MIN', count: 1, sectionSize: railW, gutterSize: 0, offset: 0 }] },
  railMin && { name: L.grid.closed, description: L.gridDesc.closed(railMin), grids: [{ pattern: 'COLUMNS', alignment: 'MIN', count: 1, sectionSize: railMin, gutterSize: 0, offset: 0 }] },
  railW && paneW && { name: L.grid.panel, description: L.gridDesc.panel(railW, paneW), grids: [{ pattern: 'COLUMNS', alignment: 'MIN', count: 1, sectionSize: railW, gutterSize: 0, offset: 0 }, { pattern: 'COLUMNS', alignment: 'MAX', count: 1, sectionSize: paneW, gutterSize: 0, offset: 0 }] },
  { name: L.grid.base, description: L.gridDesc.base, grids: [{ pattern: 'GRID', sectionSize: 4 }] },
].filter(Boolean);
const layoutBlocks = [
  { k: 'title', text: TOPIC.layout, sub: L.layoutSub(W0, H0, !!railW) },
  // the shell diagram only when the prototype declares a sidebar/panel shell (--rail-w, --pane-w)
  ...(railW && paneW ? [
    { k: 'h2', text: L.shell, sub: L.shellSub, req: 'layout-shell' },
    { k: 'diagram', req: 'layout-shell', segs: [{ label: L.seg.rail, px: railW, note: L.seg.railNote(railW, railMin), fill: cv('rail') }, { label: L.seg.content, px: W0 - railW - paneW - 8, note: L.seg.contentNote, fill: cv('bg') }, { label: '', px: 8, note: ' ', fill: cv('border') }, { label: L.seg.panel, px: paneW, note: `${paneW} px`, fill: cv('surface') }], caption: L.shellCaption(pad) },
  ] : []),
  { k: 'h2', text: L.breakpoints, req: 'layout-breakpoints' },
  { k: 'table', req: 'layout-breakpoints', widths: [200, 200, 700], head: L.bpHead,
    rows: [[L.desktop, `≥ ${bp[0] ? bp[0] + 1 : W0} px`, L.desktopNote], ...bpq.map(([q, b]) => [L.compactBp, `≤ ${b} px`, L.compactNote(q)]),
      [L.tablet, '—', L.tabletNote]] },
  { k: 'h2', text: L.containers, req: 'layout-containers' },
  { k: 'table', req: 'layout-containers', widths: [300, 160, 600], head: L.containersHead,
    rows: [...containers.map((d) => [d.sel, d.v, '—']), ...measures.map((m) => [L.runningText, m, L.readable])] },
  { k: 'h2', text: L.patterns, sub: L.patternsSub, req: 'layout-patterns' },
  { k: 'table', req: 'layout-patterns', widths: [700, 120], head: L.patternsHead, rows: gridCols.slice(0, 10).map(([v, n]) => [v, String(n)]) },
  { k: 'h2', text: L.gridStyles, req: 'layout-gridstyles' },
  { k: 'table', req: 'layout-gridstyles', widths: [360, 700], head: L.gridStylesHead, rows: gridStyles.map((g) => [g.name, g.description]) },
];
// no shell tokens is a layout choice, not a defect
check(TOPIC.layout, L.checkShell, true, railW ? L.shellNote(railW, railMin, paneW) : L.shellNone);
check(TOPIC.layout, L.checkBreakpoints, bp.length >= 2, bp.length ? L.bpNote(bp.length, bp.join(', ')) : L.none);
check(TOPIC.layout, L.checkContainers, containers.length > 0, L.containersNote(containers.length, measures.length, pad));
check(TOPIC.layout, L.checkGridStyles, gridStyles.length > 0, gridStyles.map((g) => g.name).join(', '));

// iconography
const sets = [];
for (const m of html.matchAll(/function (\w+)\(k,[^)]*\)\{\s*return '<svg class="ic([^"]*)" viewBox="([^"]+)"[^']*'([^;]*?)\+ *(\w+)\[k\]/g)) {
  const [, fn, cls, vb, attrs, obj] = m;
  const body = (new RegExp(`var ${obj} = \\{([\\s\\S]*?)\\n  \\};`).exec(html) || [])[1] || '';
  const keys = new Set([...body.matchAll(/^\s{4}(\w+):/gm)].map((x) => x[1]));
  for (const x of html.matchAll(new RegExp(`\\b${obj}\\.(\\w+) *=`, 'g'))) keys.add(x[1]);
  const line = /stroke="currentColor"/.test(attrs);
  const own = (/^\s*([a-z][\w-]*)/.exec(cls) || [])[1];
  const clsRule = own && rules.find((r) => r.sel === '.' + own && /stroke-width/.test(r.body));
  sets.push({ fn, obj, vb, line, n: keys.size, stroke: line && clsRule ? (/stroke-width:\s*([\d.]+)/.exec(clsRule.body) || [])[1] : null,
    caps: line && clsRule ? (/stroke-linecap:\s*(\w+)/.exec(clsRule.body) || [])[1] : null });
}
const icSizes = decl('width').filter((d) => /(^|\s)\.ic$/.test(d.sel) || / \.ic$/.test(d.sel)).map((d) => ({ ...d, px: parseFloat(d.v) })).filter((d) => d.px);
const bySize = Object.entries(icSizes.reduce((o, d) => ((o[d.px] = o[d.px] || []).push(d.sel.replace(/ \.ic$/, '')), o), {})).sort((a, b) => a[0] - b[0]);
const icColors = [...new Set(decl('color').filter((d) => / \.ic$/.test(d.sel)).map((d) => colorVar(d.v)).filter(Boolean))];
const iconBlocks = [
  { k: 'title', text: TOPIC.icons, sub: L.iconSub(sets.reduce((a, x) => a + x.n, 0), sets.length) },
  { k: 'h2', text: L.setsTitle, req: 'icon-style' },
  { k: 'table', req: 'icon-style', widths: [200, 140, 140, 300, 300], head: L.setsHead,
    rows: sets.map((x) => [x.line ? L.line : L.solid, String(x.n), x.vb.split(' ').slice(2).join('×'), x.line ? L.strokeNote(x.stroke || '—', x.caps || '—') : L.solidNote, x.line ? L.lineUse : L.solidUse]) },
  { k: 'h2', text: L.sizesTitle, sub: L.sizesSub, req: 'icon-sizes' },
  { k: 'table', req: 'icon-sizes', widths: [120, 960], head: L.sizesHead, rows: bySize.map(([px, sels]) => [px + ' px', [...new Set(sels)].slice(0, 8).join(', ')]) },
  { k: 'h2', text: L.rulesTitle, req: 'icon-rules' },
  { k: 'table', req: 'icon-rules', widths: [320, 760], head: L.rulesHead, rows: [
    [L.ruleColor, L.ruleColorText(icColors.includes(cv('muted')) ? ROLE.muted : L.textColor, icColors.filter((c) => /ink/.test(c)).map((c) => c.replace('color/', '')).join(', ') || '—')],
    [L.ruleLineSolid, L.ruleLineSolidText],
    [L.ruleSize, L.ruleSizeText],
    [L.ruleA11y, L.ruleA11yText]] },
  { k: 'h2', text: L.galleryTitle, sub: L.gallerySub, req: 'icon-gallery' },
  { k: 'icons', req: 'icon-gallery', size: 24 },
];
check(TOPIC.icons, L.checkIconStyle, sets.length > 0, sets.map((x) => L.iconStyleNote(x.line, x.n, x.vb, x.stroke)).join(' · '));
check(TOPIC.icons, L.checkIconSizes, bySize.length <= 4, L.iconSizesNote(bySize.length, bySize.map(([p]) => p).join(', ')));
check(TOPIC.icons, L.checkIconRules, true, L.iconRulesNote);

// elevation
const shadows = decl('box-shadow').filter((d) => d.v !== 'none' && !/var\(--dur/.test(d.v));
const parseSh = (v) => v.split(/,(?![^(]*\))/).map((p) => { const inset = /inset/.test(p); const nums = [...p.matchAll(/(-?[\d.]+)px|(?<![\w-])0(?![\w.])/g)].map((m) => parseFloat(m[1] || 0)); return { inset, x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, v: colorVar(p) }; });
const lifts = shadows.filter((d) => parseSh(d.v).some((p) => !p.inset && p.blur > 0)).map((d) => ({ ...d, p: parseSh(d.v)[0] })).sort((a, b) => a.p.blur - b.p.blur);
const ELEV_NOTE = L.elevNote;
const effectStyles = lifts.map((d, i) => ({ name: `Elevation/${i + 1}`, description: `${ELEV_NOTE[d.sel] || d.sel} · box-shadow: ${d.v}`, effects: [{ type: 'DROP_SHADOW', y: d.p.y, blur: d.p.blur, spread: d.p.spread, v: d.p.v }] }));
const reVar = (r) => String(ROLE[r] || r).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RINGS = [[L.ring.selected, new RegExp(`^inset 0 0 0 2px var\\(--${reVar('fg')}\\)$`), L.ringNote.selected], [L.ring.off, new RegExp(`^inset 0 0 0 1\\.5px var\\(--${reVar('muted')}\\)$`), L.ringNote.off], [L.ring.cutout, new RegExp(`^0 0 0 2px var\\(--${reVar('surface')}\\)$`), L.ringNote.cutout]];
for (const [name, re, note] of RINGS) {
  const d = shadows.find((x) => re.test(x.v)); if (!d) continue;
  const p = parseSh(d.v)[0];
  effectStyles.push({ name, description: `${note} · box-shadow: ${d.v}`, effects: [{ type: p.inset ? 'INNER_SHADOW' : 'DROP_SHADOW', blur: 0, spread: p.spread, v: p.v }] });
}
const focusOutline = decl('outline').find((d) => /solid/.test(d.v));
if (focusOutline) {
  const w = parseFloat(focusOutline.v), off = (() => {
    // the offset most focus rules use (one rule can pull the ring inside with a negative one)
    const sels = new Set(decl('outline').filter((d) => /solid/.test(d.v)).map((d) => d.sel));
    const offs = decl('outline-offset').filter((d) => sels.has(d.sel)).map((d) => parseFloat(d.v) || 0);
    const cnt = offs.reduce((o, x) => ((o[x] = (o[x] || 0) + 1), o), {});
    return +(Object.entries(cnt).sort((a, b) => b[1] - a[1])[0] || [0])[0];
  })();
  effectStyles.push({ name: L.ring.focus, description: L.focusNote(focusOutline.v, off), effects: [{ type: 'DROP_SHADOW', blur: 0, spread: off, v: cv('bg') }, { type: 'DROP_SHADOW', blur: 0, spread: off + w, v: colorVar(focusOutline.v) }].reverse() });
}
const focusCount = decl('outline').filter((d) => /solid/.test(d.v)).length;
const elevBlocks = [
  { k: 'title', text: L.elevTitle, sub: L.elevSub },
  { k: 'h2', text: L.levels2, req: 'elev-levels' },
  { k: 'elev', req: 'elev-levels', items: [{ label: L.level0, note: L.level0Note }, ...effectStyles.filter((e) => /^Elevation/.test(e.name)).map((e) => ({ style: e.name, label: e.name.replace('Elevation/', L.levelN), note: e.description }))] },
  { k: 'h2', text: L.rings, sub: L.ringsSub, req: 'elev-rings' },
  { k: 'elev', req: 'elev-rings', items: effectStyles.filter((e) => /^Ring/.test(e.name)).map((e) => ({ style: e.name, label: e.name.replace('Ring/', ''), note: e.description, fill: cv('surface'), ...(e.name === L.ring.cutout ? { backdrop: has('bar-edge') ? 'color/bar-edge' : cv('border') } : {}) })) },
  { k: 'table', req: 'elev-table', widths: [220, 460, 400], head: L.elevHead, rows: effectStyles.map((e) => [e.name, e.description.split(' · ').slice(1).join(' · '), e.description.split(' · ')[0]]) },
];
check(TOPIC.elevation, L.checkLevels, lifts.length >= 2, lifts.map((d) => `${d.sel} ${d.v}`).join(' · '));
check(TOPIC.elevation, L.checkEffects, effectStyles.length > 0, effectStyles.map((e) => e.name).join(', '));
check(TOPIC.elevation, L.checkFocus, focusCount >= 5, L.focusCountNote(focusCount));

// borders and radii
const radDecl = decl('border-radius');
const radTok = radDecl.filter((d) => /var\(--r-/.test(d.v)).length;
const radCircle = radDecl.filter((d) => /50%/.test(d.v)).length;
const radLit = radDecl.filter((d) => !/var\(--r-|50%|inherit|^0$/.test(d.v));
const radii = tokens.filter((t) => t.type === 'dimension' && /^--r-/.test(t.name));
const bw = {}; for (const d of rules.flatMap((r) => r.body.split(';').filter((x) => /^\s*border(-(top|right|bottom|left))?\s*:/.test(x)))) { const m = /([\d.]+)px/.exec(d); if (m) bw[m[1]] = (bw[m[1]] || 0) + 1; }
const bstyles = [...new Set([...cssNC.matchAll(/border[a-z-]*:[^;}]*\b(solid|dashed|dotted|double)\b/g)].map((m) => m[1]))];
const bwList = Object.entries(bw).sort((a, b) => b[1] - a[1]);
const strokeVars = ['1', '1.5', '2'].map((w) => ({ name: `border/${w.replace('.', '_')}`, value: +w, scopes: ['STROKE_FLOAT'], code: `${w}px`, description: L.widthDesc(w) }));
const borderBlocks = [
  { k: 'title', text: TOPIC.borders, sub: L.bordersSub(radTok, radCircle, radLit.length, bstyles.join(', ') || 'solid') },
  { k: 'h2', text: L.radii, req: 'border-radii' },
  { k: 'radii', req: 'border-radii', items: [...radii.map((t) => ({ v: `radius/${name(t).slice(2)}`, label: `radius/${name(t).slice(2)}`, note: `${t.values[themes[0]]} · var(${t.name})` })), { r: 999, w: 72, h: 72, label: L.circle, note: L.circleNote }] },
  { k: 'p', muted: true, req: 'border-offscale', text: radLit.length ? L.rawRadii(Object.entries(radLit.reduce((o, d) => ((o[d.v] = (o[d.v] || 0) + 1), o), {})).map(([v, n]) => `${v} (${n})`).join(', ')) : L.allRadiiTokens },
  { k: 'h2', text: L.widths, sub: L.widthsSub, req: 'border-widths' },
  { k: 'radii', req: 'border-widths', items: strokeVars.map((v) => ({ wv: v.name, sw: v.value, stroke: cv('border'), label: v.name, note: L.widthNote(v.value, bw[String(v.value)] || 0) })) },
  { k: 'h2', text: L.borderColors, req: 'border-colors' },
  { k: 'swatches', req: 'border-colors', items: colors.filter((t) => catOf(name(t)) === 'borders').map((t) => ({ v: 'color/' + name(t), note: `var(${t.name})` })) },
];
check(TOPIC.borders, L.checkRadii, radLit.length <= radTok * 0.15, L.radiiNote(radTok, radCircle, radLit.length));
check(TOPIC.borders, L.checkWidths, bwList.length > 0, bwList.map(([w, n]) => `${w}px×${n}`).join(', '));
check(TOPIC.borders, L.checkBorderStyles, bstyles.length > 0, bstyles.join(', '));

// ---------------------------------------------------------------------------------- write ---
mkdirSync(outDir, { recursive: true });
const page = state.pages.foundations;
const legacy = MODES.map((m) => `Foundations · ${m}`);
const files = [
  ['F1-color.js', { page, topic: TOPIC.color, order: 1, modes: MODES, blocks: colorBlocks, legacy,
    tones: Object.fromEntries([LV.aaa, LV.aa, LV.aaUi, LV.aaLarge, LV.fail].map((l) => [l, badgeTone(l === LV.fail ? 0 : l === LV.aaLarge ? 3 : 4.5)])) }],
  ...(typeBlocks.length ? [['F2-type.js', { page, topic: TOPIC.type, order: 2, modes: MODES, blocks: typeBlocks, textStyles }]] : []),
  ['F3-space.js', { page, topic: TOPIC.space, order: 3, modes: [MODES[0]], blocks: spaceBlocks, spaceVars }],
  ['F4-layout.js', { page, topic: TOPIC.layout, order: 4, modes: [MODES[0]], blocks: layoutBlocks, gridStyles }],
  ['F5-icons.js', { page, topic: TOPIC.icons, order: 5, modes: MODES, blocks: iconBlocks, componentsPage: TOKENS_PAGE }],
  ['F6-elevation.js', { page, topic: TOPIC.elevation, order: 6, modes: MODES, blocks: elevBlocks, effectStyles }],
  ['F7-borders.js', { page, topic: TOPIC.borders, order: 7, modes: [MODES[0]], blocks: borderBlocks, floatVars: strokeVars }],
];
// every board also gets the docs-language texts of the template (samples, default description)
// and the project's house style (the template's defaults when the state has none)
const BASE = { collection: 'Tokens', textStyles: [], spaceVars: [], legacy: [],
  text: { pairSample: L.pairSample, specimen: L.specimen, descModes: labelsFor(state).boardDesc.modes, descSingle: labelsFor(state).boardDesc.single },
  ...(state.style ? { style: state.style } : {}) };
for (const [f, p] of files) writeFileSync(path.join(outDir, f), fill({ ...BASE, ...p }));
writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(audit, null, 1));
// one call per stage: the topics of a stage run in a loop inside a single use_figma script
// (the template body is shared, so this is far smaller than the separate files together)
const tpl = readFileSync(path.join(here, 'figma', 'foundation-board.js'), 'utf8');
const body = tpl.slice(tpl.indexOf('\nconst F = ')).replace(/\nreturn out;\s*$/, '\nresults.push(out);\n');
const stage = (name, list) => writeFileSync(path.join(outDir, name), `// generated by gen-foundations.mjs — ${list.map(([f]) => f).join(', ')} in one call\n` +
  `const LIST = ${JSON.stringify(list.map(([, p]) => ({ ...BASE, ...p })))};\nconst results = [];\n` +
  `for (const PARAMS of LIST) {\n${body}}\nreturn results;\n`);
stage('stage1.js', files.filter(([f]) => /^F[123]-/.test(f)));
stage('stage2.js', files.filter(([f]) => /^F[4567]-/.test(f)));
console.log(JSON.stringify({ files: files.map(([f]) => f), textStyles: textStyles.length, headings: headings.map((s) => s.name), space: scale, contrastPairs: contrast.length,
  audit: audit.map((a) => `${a.ok ? 'OK ' : 'NO '} ${a.topic} · ${a.item} — ${a.note}`) }, null, 1));
