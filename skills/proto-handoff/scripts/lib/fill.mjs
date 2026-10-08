// Turns use_figma templates into scripts.
//
//   fill(tpl, params)       one self-contained script (the template with its PARAMS and shared
//                           snippets inlined) — for a single call or when nothing is installed
//   install(tpls)           one script that stores the templates' code IN the Figma file
//                           (document shared plugin data "uicode", with a hash per template)
//   run(tpl, params)        a tiny script that runs an installed template with these PARAMS
//
// Why install: a script travels inline in the tool call, and a subagent spends one to two
// minutes just emitting a 20 KB script; a long call can also be cut in transit. Installed once,
// every later call carries only its PARAMS (a few KB). The runner refuses to run a template whose
// stored hash differs from the one it was generated for, so an outdated copy never runs.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const lib = (f) => readFileSync(path.join(here, f), 'utf8');
const PARAMS_RE = /\/\*PARAMS\*\/[\s\S]*?\/\*END\*\//;

function kit(part) {
  // the kit's /*@build*/ and /*@swap*/ blocks go only to the template that asks for them (KIT:build)
  return lib('figma-kit.js').replace(/\/\*@(\w+)\*\/([\s\S]*?)\/\*@end\*\//g, (m, name, body) => (!part || name === part ? body : ''));
}
function source(tpl) {
  return readFileSync(path.join(here, '..', 'figma', tpl), 'utf8')
    .replace('/*MATCHER*/', () => lib('figma-match.js'))
    .replace('/*SHAPE*/', () => lib('figma-shape.js'))
    .replace('/*TEXT*/', () => lib('figma-text.js'))
    .replace(/\/\*KIT(?::(\w+))?\*\//, (m, part) => kit(part));
}
// full-line comments and indentation out; lines inside a template literal are left alone
export function compact(code) {
  const out = [];
  let inTpl = false;
  for (const line of code.split('\n')) {
    const t = line.trim();
    if (!inTpl && (t === '' || t.startsWith('//'))) continue;
    out.push(inTpl ? line : t);
    const ticks = (line.replace(/\\`/g, '').match(/`/g) || []).length;
    if (ticks % 2) inTpl = !inTpl;
  }
  return out.join('\n') + '\n';
}
export function fill(tpl, params) {
  return compact(source(tpl).replace(PARAMS_RE, () => (typeof params === 'string' ? params : JSON.stringify(params))));
}
// the stored body: the PARAMS declaration goes (PARAMS arrives as an argument)
const body = (tpl) => compact(source(tpl).replace(/const PARAMS = \/\*PARAMS\*\/[\s\S]*?\/\*END\*\/;?/, ''));
export const hashOf = (tpl) => createHash('sha256').update(body(tpl)).digest('hex').slice(0, 12);
// the code travels as a raw template literal, not a JSON string: the runner re-emits every install
// script, and doubled escapes did not survive it (`/^Icon\\//` arrived as `/^Icon//` and the stored
// build-level failed to parse). Backticks and `${` go as markers; the length and an FNV-1a sum are
// checked in the file before anything is stored, so a changed copy is refused, never installed
const BT = '~bt~', DL = '~dl~';
export const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const FNV = 'const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };';
function carry(text) {
  if (text.includes(BT) || text.includes(DL) || /\\$/.test(text)) throw new Error('template text cannot travel raw');
  return `{ s: String.raw\`${text.split('`').join(BT).split('${').join(DL)}\`.split(${JSON.stringify(BT)}).join('\`').split(${JSON.stringify(DL)}).join('\${'), n: ${text.length}, h: ${fnv(text)} }`;
}
const VERIFY = `for (const [k, c] of STORE) if (c.s.length !== c.n || fnv(c.s) !== c.h) return { error: 'the code of ' + k + ' arrived changed in transit (' + c.s.length + ' of ' + c.n + ' characters): run this install script again, unchanged' };`;
export function install(tpls) {
  const store = tpls.map((t) => `[${JSON.stringify(t.replace(/\.js$/, ''))}, ${carry(body(t))}]`);
  const lines = tpls.map((t) => {
    const name = t.replace(/\.js$/, '');
    return `figma.root.setSharedPluginData('uicode', ${JSON.stringify(name + ':parts')}, '0');\n` +
      `figma.root.setSharedPluginData('uicode', ${JSON.stringify(name + ':hash')}, ${JSON.stringify(hashOf(t))});`;
  });
  return `// installs templates into this file (document shared plugin data "uicode")\n${FNV}\nconst STORE = [\n${store.join(',\n')}\n];\n${VERIFY}\n` +
    `for (const [k, c] of STORE) figma.root.setSharedPluginData('uicode', k, c.s);\n${lines.join('\n')}\nreturn { installed: ${JSON.stringify(tpls.map((t) => t.replace(/\.js$/, '')))} };\n`;
}
// a template too big for one call (a call past 50 000 characters does not go out) is stored in
// parts, one call each, in order; the last one writes the hash, so a template whose parts did not
// all arrive never runs
function installParts(t, max) {
  const name = t.replace(/\.js$/, ''), src = body(t), parts = [];
  for (let i = 0; i < src.length;) {
    let j = Math.min(src.length, i + max);
    if (j < src.length) { const nl = src.lastIndexOf('\n', j); if (nl > i) j = nl + 1; }
    parts.push(src.slice(i, j)); i = j;
  }
  return parts.map((p, k) => `// installs part ${k + 1} of ${parts.length} of template ${name} (document shared plugin data "uicode")\n` +
    `${FNV}\nconst STORE = [[${JSON.stringify(name + '#' + k)}, ${carry(p)}]];\n${VERIFY}\n` +
    (k === 0 ? `figma.root.setSharedPluginData('uicode', ${JSON.stringify(name + ':hash')}, '');\n` : '') +
    `figma.root.setSharedPluginData('uicode', ${JSON.stringify(name + '#' + k)}, STORE[0][1].s);\n` +
    (k === parts.length - 1 ? `figma.root.setSharedPluginData('uicode', ${JSON.stringify(name + ':parts')}, '${parts.length}');\n` +
      `figma.root.setSharedPluginData('uicode', ${JSON.stringify(name + ':hash')}, ${JSON.stringify(hashOf(t))});\n` : '') +
    `return { installed: ${JSON.stringify(name)}, part: ${k + 1}, of: ${parts.length} };\n`);
}
// the stored code of an installed template, whole or in parts (read inside the Figma script)
const LOAD = `const code = (T) => { const n = +figma.root.getSharedPluginData('uicode', T + ':parts') || 0; return n ? Array.from({ length: n }, (_, k) => figma.root.getSharedPluginData('uicode', T + '#' + k)).join('') : figma.root.getSharedPluginData('uicode', T); };`;
export function run(tpl, params) {
  const name = tpl.replace(/\.js$/, '');
  return `const T = ${JSON.stringify(name)}, H = ${JSON.stringify(hashOf(tpl))};
if (figma.root.getSharedPluginData('uicode', T + ':hash') !== H) return { error: 'template ' + T + ' is not installed or is outdated: run the install script first' };
const AF = Object.getPrototypeOf(async function () {}).constructor;
${LOAD}
return await new AF('figma', 'PARAMS', code(T))(figma, ${typeof params === 'string' ? params : JSON.stringify(params)});
`;
}
// install scripts for a set of templates, split so no call carries more than ~40 KB; each entry
// says which templates it stores (installCheck uses it)
export function installPlan(tpls, max = 40000) {
  const out = [];
  let cur = [], size = 0;
  const flush = () => { if (cur.length) out.push({ code: install(cur), tpls: cur }); cur = []; size = 0; };
  for (const t of tpls) {
    const n = body(t).length;
    if (n > 2 * max) { flush(); out.push(...installParts(t, max).map((code) => ({ code, tpls: [t] }))); continue; }
    if (cur.length && size + n > max) flush();
    cur.push(t); size += n;
  }
  flush();
  return out;
}
export const installChunks = (tpls, max = 40000) => installPlan(tpls, max).map((x) => x.code);
// a tiny script that says which install scripts can be skipped: the file already stores every
// template they carry at the same hash. A sync usually changes no template, and the runner then
// spends no minutes emitting 20 KB installs that would store what is already there
// the stored code itself is compared (length and FNV sum), not only its hash tag: a copy damaged
// in transit by an older install carries the right tag
export function installCheck(files) {
  const want = files.map(({ name, tpls }) => [name, tpls.map((t) => { const b = body(t); return [t.replace(/\.js$/, ''), hashOf(t), b.length, fnv(b)]; })]);
  return `// which install scripts are needed (the rest store what the file already has)
${FNV}
${LOAD}
const WANT = ${JSON.stringify(want)};
const skip = [], run = [];
for (const [file, tpls] of WANT) (tpls.every(([T, H, n, h]) => { if (figma.root.getSharedPluginData('uicode', T + ':hash') !== H) return false; const c = code(T); return c.length === n && fnv(c) === h; }) ? skip : run).push(file);
return { skip, run };
`;
}
// several installed templates in one call, in order; stops at the first error. A call that runs
// past the tool's time budget keeps running in the background, so a chain stays safe to use for
// fast steps (builds, small batches) and each step's result comes back in `steps`.
export function chain(steps) {
  const list = steps.map(([tpl, params]) => ({ T: tpl.replace(/\.js$/, ''), H: hashOf(tpl), P: typeof params === 'string' ? JSON.parse(params) : params }));
  return `const STEPS = ${JSON.stringify(list)};
const AF = Object.getPrototypeOf(async function () {}).constructor;
${LOAD}
const steps = [];
for (const s of STEPS) {
  if (figma.root.getSharedPluginData('uicode', s.T + ':hash') !== s.H) { steps.push({ T: s.T, error: 'template not installed or outdated' }); break; }
  let r;
  try { r = await new AF('figma', 'PARAMS', code(s.T))(figma, s.P); } catch (e) { steps.push({ T: s.T, error: String(e).slice(0, 300) }); break; }
  steps.push({ T: s.T, r });
  if (r && r.error) break;
  if (r && r._pending && r._pending.length) return { steps, pending: true };
}
return { steps };
`;
}
