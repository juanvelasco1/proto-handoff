// User configuration: one file per person, outside the skill, so updating the skill never
// overwrites it and a bad value never reaches the scripts.
//
//   ~/.proto-handoff/config.jsonc          (PROTO_HANDOFF_CONFIG=<path> overrides the location)
//
// Everything here is a preference. The mechanics (the data-ui contract, the order of the
// scripts, idempotency, the audit loop, the state.json schema) are not configurable on purpose.
// A missing file means "all defaults"; a file with an invalid value stops the run with a clear
// message instead of half-working.
import { readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME_DIR = path.join(os.homedir(), '.proto-handoff');

export const expandHome = (p) => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? path.join(os.homedir(), p.slice(1)) : p);

export function configPath() {
  return process.env.PROTO_HANDOFF_CONFIG ? path.resolve(expandHome(process.env.PROTO_HANDOFF_CONFIG)) : path.join(HOME_DIR, 'config.jsonc');
}

export const DEFAULTS = Object.freeze({
  language: 'auto',
  docsLanguage: 'en',
  workRoot: '~/.proto-handoff/projects',
  server: { port: 8777 },
  viewport: { width: 1440, height: 900 },
  pageNames: { cover: 'Cover', foundations: 'Foundations', components: 'Components', screens: 'Screens', flows: 'User flows' },
  outputs: { cover: true, foundations: true, flowMap: true, darkScreens: true, prototypeLinks: true },
  style: { pageBg: '#cacaca', sectionFill: '#bdbdbd', title: '#1a1c1f', subtle: '#3d3f42', gap: 200 },
  audit: { tolerancePx: 2, minScreenPct: 90, systematicScreens: 3 },
  browser: { chromePath: null },
  agent: { subagents: 'auto' },
});

// ---- validators: each returns an error message or null -------------------------------------
const int = (min, max) => (v) => (Number.isInteger(v) && v >= min && v <= max ? null : `a whole number from ${min} to ${max}`);
const num = (min, max) => (v) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? null : `a number from ${min} to ${max}`);
const bool = () => (v) => (typeof v === 'boolean' ? null : 'true or false (no quotes)');
const oneOf = (list) => (v) => (list.includes(v) ? null : `one of ${list.map((x) => JSON.stringify(x)).join(', ')}`);
const hex = () => (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? null : 'a 6-digit hex color such as "#bdbdbd"');
const text = (max) => (v) => (typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f]/.test(v) ? null : `a non-empty text of at most ${max} characters`);
const lang = () => (v) => (typeof v === 'string' && /^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/.test(v) ? null : '"auto" or a language code such as "en", "es" or "pt-BR"');
const dir = () => (v) => (typeof v === 'string' && v.trim() && !v.includes('\0') ? null : 'a folder path such as "~/.proto-handoff/projects"');
const nullableText = (max) => (v) => (v === null ? null : text(max)(v) && `null or ${text(max)(v)}`);

const SCHEMA = {
  language: lang(),
  docsLanguage: oneOf(['en', 'es']),
  workRoot: dir(),
  server: { port: int(1024, 65535) },
  viewport: { width: int(240, 3840), height: int(240, 4320) },
  pageNames: { cover: text(60), foundations: text(60), components: text(60), screens: text(60), flows: text(60) },
  outputs: { cover: bool(), foundations: bool(), flowMap: bool(), darkScreens: bool(), prototypeLinks: bool() },
  style: { pageBg: hex(), sectionFill: hex(), title: hex(), subtle: hex(), gap: int(0, 2000) },
  audit: { tolerancePx: num(0, 20), minScreenPct: num(50, 100), systematicScreens: int(1, 1000) },
  browser: { chromePath: nullableText(1000) },
  agent: { subagents: oneOf(['auto', 'never']) },
};

// ---- JSONC: comments and trailing commas out, strings untouched -----------------------------
export function stripJsonc(src) {
  let out = '', i = 0, inStr = false;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === '"') inStr = false;
      i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const chunk = src.slice(i, end < 0 ? src.length : end + 2);
      out += chunk.replace(/[^\n]/g, ' ');   // keep line numbers for error messages
      i += chunk.length; continue;
    }
    out += c; i++;
  }
  // trailing commas before } or ] (outside strings: strings were copied verbatim, so re-scan)
  let res = '', s = false;
  for (let k = 0; k < out.length; k++) {
    const c = out[k];
    if (s) { res += c; if (c === '\\') { res += out[++k] ?? ''; } else if (c === '"') s = false; continue; }
    if (c === '"') { s = true; res += c; continue; }
    if (c === ',') {
      let j = k + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === '}' || out[j] === ']') continue;
    }
    res += c;
  }
  return res;
}

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
  }
  return d[a.length][b.length];
};
const suggest = (key, keys) => {
  const best = keys.map((k) => [k, lev(key, k)]).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= Math.max(2, Math.floor(key.length / 3)) ? ` (did you mean "${best[0]}"?)` : '';
};

function validate(user, schema, defaults, where, errors) {
  const out = {};
  if (user === undefined) user = {};
  if (user === null || typeof user !== 'object' || Array.isArray(user)) {
    errors.push(`${where || 'the file'} must be an object { … }`);
    return structuredClone(defaults);
  }
  for (const key of Object.keys(user)) {
    if (key.startsWith('$')) continue;   // "$schema", "$comment": allowed and ignored
    if (!(key in schema)) errors.push(`unknown setting "${where ? where + '.' : ''}${key}"${suggest(key, Object.keys(schema))}`);
  }
  for (const [key, rule] of Object.entries(schema)) {
    const at = where ? `${where}.${key}` : key;
    const has = Object.prototype.hasOwnProperty.call(user, key);
    if (typeof rule === 'function') {
      if (!has) { out[key] = defaults[key]; continue; }
      const err = rule(user[key]);
      if (err) { errors.push(`"${at}" is ${JSON.stringify(user[key])}; it must be ${err} (default: ${JSON.stringify(defaults[key])})`); out[key] = defaults[key]; }
      else out[key] = user[key];
    } else {
      out[key] = validate(has ? user[key] : undefined, rule, defaults[key], at, errors);
    }
  }
  return out;
}

// WCAG contrast of the documentation inks on the section fill: the house style promises AA
const lum = (h) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export class ConfigError extends Error {
  constructor(file, problems) {
    super(`Invalid configuration in ${file}:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
      'Fix these values (or delete the line to use the default) and run the command again. Nothing was changed.');
    this.problems = problems;
    this.file = file;
  }
}

// Returns { config, file, exists, warnings }. Throws ConfigError when the file is invalid.
export function loadConfig({ file = configPath() } = {}) {
  const exists = existsSync(file);
  let user = {};
  if (exists) {
    const raw = readFileSync(file, 'utf8');
    try { user = JSON.parse(stripJsonc(raw)); }
    catch (e) {
      const m = String(e.message).match(/position (\d+)/);
      const line = m ? stripJsonc(raw).slice(0, +m[1]).split('\n').length : null;
      throw new ConfigError(file, [`the file is not valid JSON${line ? ` near line ${line}` : ''}: ${e.message}`]);
    }
  }
  const errors = [];
  const config = validate(user, SCHEMA, DEFAULTS, '', errors);
  if (errors.length) throw new ConfigError(file, errors);
  config.workRoot = path.resolve(expandHome(config.workRoot));
  if (config.browser.chromePath) config.browser.chromePath = path.resolve(expandHome(config.browser.chromePath));
  const warnings = [];
  const s = config.style;
  for (const [name, min] of [['title', 4.5], ['subtle', 4.5]]) {
    const c = contrast(s[name], s.sectionFill);
    if (c < min) warnings.push(`style.${name} on style.sectionFill has contrast ${c.toFixed(2)}:1 (below ${min}:1, WCAG AA): documentation text will be hard to read`);
  }
  if (config.viewport.width < config.viewport.height && config.viewport.width > 600) warnings.push('viewport is portrait but wider than a phone: check width/height are not swapped');
  return { config, file, exists, warnings };
}

// The per-project part of the config, as state.json stores it (init-project.mjs writes it).
export function projectSettings(config) {
  return {
    width: config.viewport.width,
    height: config.viewport.height,
    baseUrl: `http://127.0.0.1:${config.server.port}/figma.html`,
    themes: config.outputs.darkScreens ? ['light', 'dark'] : ['light'],
    style: { ...config.style },
    pageNames: { ...config.pageNames },
    options: {
      docsLanguage: config.docsLanguage,
      outputs: { ...config.outputs },
      audit: { ...config.audit },
    },
  };
}
