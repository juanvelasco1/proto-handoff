#!/usr/bin/env node
// Run before every publish (and in CI): nothing private or secret may leave with the repo.
//
//   node tools/prepublish-check.mjs            scan the files that would be published
//   node tools/prepublish-check.mjs --history  also scan every commit in the git history
//
// It looks for: credentials and tokens, e-mail addresses (except GitHub noreply and example
// domains), absolute paths from someone's computer, links to real Figma files, files that must
// never be published (personal config, project state, backups, captures), big binaries, and
// every word listed in .private-terms.txt (one per line; that file is git-ignored on purpose:
// committing it would publish the very words it protects).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withHistory = process.argv.includes('--history');

const SECRET = [
  ['Figma personal access token', /figd_[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['API key (sk-…)', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['token in a config value', /"(figma_?token|access_?token|api_?key|secret|password)"\s*:\s*"[^"<>\s]{8,}"/i],
];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const EMAIL_OK = /(@users\.noreply\.github\.com|@example\.(com|org)|@anthropic\.com)$/i;
const HOME_PATH = /(\/Users\/(?!\$|<|you\b|me\b|name\b)[A-Za-z0-9._-]+\/|\/home\/(?!\$|<|you\b|user\b)[A-Za-z0-9._-]+\/|C:\\Users\\(?!<|you\b)[A-Za-z0-9._-]+\\)/;
const FIGMA_FILE = /figma\.com\/(design|file|proto|board)\/(?!<|KEY|FILE_KEY|AbC)[A-Za-z0-9]{10,}/;
const NEVER_FILES = [/(^|\/)state\.json$/, /(^|\/)config\.jsonc?$/, /(^|\/)fingerprints[^/]*\.json$/, /\.bak(-[^/]*)?$/, /(^|\/)\.env(\..*)?$/, /(^|\/)node_modules\//, /(^|\/)\.private-terms\.txt$/, /\.(pem|key)$/];
const BINARY = /\.(png|jpe?g|gif|webp|avif|pdf|zip|fig)$/i;
const MAX_BYTES = 1024 * 1024;

const privateTerms = existsSync(path.join(root, '.private-terms.txt'))
  ? readFileSync(path.join(root, '.private-terms.txt'), 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
  : [];

const isGit = existsSync(path.join(root, '.git'));
function publishedFiles() {
  if (isGit) {
    // tracked + untracked-but-not-ignored: exactly what a commit of everything would include
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString();
    return out.split('\0').filter(Boolean).filter((f) => existsSync(path.join(root, f)));
  }
  const list = [];
  const walk = (d) => {
    for (const e of readdirSync(path.join(root, d), { withFileTypes: true })) {
      const rel = d ? `${d}/${e.name}` : e.name;
      if (e.name === '.git' || e.name === 'node_modules' || e.name === '.private-terms.txt' || e.name === '.DS_Store') continue;
      if (e.isDirectory()) walk(rel); else list.push(rel);
    }
  };
  walk('');
  return list;
}

const findings = [];
const add = (where, what, sample = '') => findings.push({ where, what, sample: sample.slice(0, 80) });

function scanText(where, text) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const at = `${where}:${i + 1}`;
    for (const [name, re] of SECRET) { const m = line.match(re); if (m) add(at, name, m[0]); }
    for (const m of line.matchAll(EMAIL)) if (!EMAIL_OK.test(m[0]) && !/\.(png|jpe?g|svg|js|mjs|css)$/i.test(m[0])) add(at, 'e-mail address', m[0]);
    const hp = line.match(HOME_PATH); if (hp) add(at, 'absolute path from a personal computer', hp[0]);
    const fl = line.match(FIGMA_FILE); if (fl) add(at, 'link to a real Figma file', fl[0]);
    const low = line.toLowerCase();
    for (const t of privateTerms) if (low.includes(t.toLowerCase())) add(at, 'private term (.private-terms.txt)', t);
  });
}

const files = publishedFiles();
for (const f of files) {
  if (f === 'tools/prepublish-check.mjs') continue;   // its own patterns would match themselves
  for (const re of NEVER_FILES) if (re.test(f)) add(f, 'file that must never be published');
  const size = statSync(path.join(root, f)).size;
  if (size > MAX_BYTES) add(f, `file larger than 1 MB (${(size / 1048576).toFixed(1)} MB)`);
  if (BINARY.test(f)) { add(f, 'binary file (a capture or screenshot may hold private content): check it by hand'); continue; }
  const buf = readFileSync(path.join(root, f));
  if (buf.includes(0)) continue;
  scanText(f, buf.toString('utf8'));
}

if (withHistory) {
  if (!isGit) add('(history)', 'not a git repository: nothing to scan');
  else {
    const log = execFileSync('git', ['log', '--all', '-p', '--no-color', '--format=commit %H%nauthor %an <%ae>'], { cwd: root, maxBuffer: 512 * 1024 * 1024 }).toString();
    let commit = '?';
    for (const line of log.split('\n')) {
      if (line.startsWith('commit ')) { commit = line.slice(7, 19); continue; }
      if (line.startsWith('author ')) {
        const m = line.match(/<([^>]+)>/);
        if (m && !EMAIL_OK.test(m[1])) add(`commit ${commit}`, 'commit author e-mail is not a GitHub noreply address', m[1]);
        continue;
      }
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      if (/prepublish-check\.mjs/.test(line)) continue;
      scanText(`commit ${commit}`, line.slice(1));
    }
  }
}

if (!privateTerms.length) console.log('Note: no .private-terms.txt found; add the names that must never be published (one per line).');
if (!findings.length) {
  console.log(`OK: ${files.length} files${withHistory ? ' and the git history' : ''} scanned, nothing private or secret found.`);
  process.exit(0);
}
const seen = new Set();
console.log(`Found ${findings.length} problem(s). Fix them before publishing:\n`);
for (const f of findings) {
  const key = `${f.where}|${f.what}|${f.sample}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`- ${f.where}: ${f.what}${f.sample ? ` → ${f.sample}` : ''}`);
}
process.exit(1);
