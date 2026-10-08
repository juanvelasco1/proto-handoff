#!/usr/bin/env node
// Serves a project's work folder so the capture can load the migrated prototype over http (the
// capture does not accept file:// pages).
//
//   node serve.mjs <dir> [--port N] [--cors-any]      (N defaults to server.port in the config)
//
// Safe by default, because the work folder also holds state.json (the Figma file key), logs and
// the DOM maps:
//   · listens on 127.0.0.1 only: nothing else on the network can reach it
//   · serves static web assets only (html, css, js, images, fonts); everything else, JSON
//     included, is 403. No directory listings; paths that leave <dir> are refused
//   · Access-Control-Allow-Origin is sent only to loopback origins (http://127.0.0.1:*,
//     http://localhost:*) and to https://www.figma.com / https://mcp.figma.com, so a website open
//     in the browser cannot read the prototype while the server runs. --cors-any sends "*" to
//     everyone, for a capture that turns out to need it
//   · Cache-Control: no-store, so a re-migrated copy is never served stale
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './lib/config.mjs';

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--port');
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
// the port: --port, else server.port from the user's config (default 8777)
const port = +opt('--port', loadConfig().config.server.port);
const corsAny = args.includes('--cors-any');
if (!root) { console.error('usage: node serve.mjs <dir> [--port 8777] [--cors-any]'); process.exit(2); }
const ROOT = path.resolve(root);
if (!statSync(ROOT, { throwIfNoEntry: false })?.isDirectory()) { console.error(`not a directory: ${ROOT}`); process.exit(2); }
if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error(`invalid --port ${opt('--port')}: use 1024–65535`); process.exit(2); }

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
};
const ALLOWED_ORIGIN = (o) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o) || o === 'https://www.figma.com' || o === 'https://mcp.figma.com';

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (corsAny) headers['Access-Control-Allow-Origin'] = '*';
  else if (origin && ALLOWED_ORIGIN(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
  const end = (code, msg) => { res.writeHead(code, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(msg + '\n'); };
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': '*' }); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') return end(405, 'method not allowed');
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { return end(400, 'bad request'); }
  if (rel.includes('\0')) return end(400, 'bad request');
  const file = path.resolve(ROOT, '.' + path.posix.normalize('/' + rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return end(403, 'forbidden');
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return end(403, 'forbidden: only static web assets are served');
  const st = statSync(file, { throwIfNoEntry: false });
  if (!st || !st.isFile()) return end(404, 'not found');
  res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
});
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `port ${port} is in use: pass another with --port` : e.message); process.exit(1); });
server.listen(port, '127.0.0.1', () => console.log(`serving ${ROOT} at http://127.0.0.1:${port}/ (static assets only${corsAny ? ', CORS *' : ''})`));
