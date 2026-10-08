#!/usr/bin/env node
// Captures one batch of screens with fresh capture ids. The ids expire minutes after they are
// issued, so a capture agent asks for them right before each batch (agents/capture.md).
//
//   node capture-run.mjs <work-dir> <migrated-url> <jobs.json> <from> <to> <id1,id2,…> [--trim sel:keep]
//
// from..to are 1-based job numbers, inclusive, one id per job in order. The maps of the batch go
// to <work-dir>/capture/b<from>; its sent.json says which capture id went to which screen
// (capture-record.mjs reads it). Prints "<n> <status> <captureId>" per screen.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [work, url, jobsFile, from, to, idsArg] = process.argv.slice(2);
const ids = (idsArg || '').split(',').map((s) => s.trim()).filter(Boolean);
const a = +from, b = +to;
if (!work || !url || !jobsFile || !a || !b) throw new Error('usage: capture-run.mjs <work-dir> <url> <jobs.json> <from> <to> <ids>');
if (ids.length !== b - a + 1) throw new Error(`need ${b - a + 1} ids, got ${ids.length}`);
const jobs = JSON.parse(readFileSync(jobsFile, 'utf8'));
ids.forEach((id, k) => { jobs[a - 1 + k].captureId = id; });
const dir = path.join(work, 'capture');
const out = path.join(dir, 'b' + String(a).padStart(2, '0'));
mkdirSync(out, { recursive: true });
const runFile = path.join(out, 'jobs.json');
writeFileSync(runFile, JSON.stringify(jobs, null, 1));
const only = Array.from({ length: b - a + 1 }, (_, k) => a + k).join(',');
// --trim .table-row:120 passes through to capture-batch (a list too long for the capture service)
const ti = process.argv.indexOf('--trim');
const extra = ti >= 0 ? ['--trim', process.argv[ti + 1]] : [];
const res = execFileSync('node', [path.join(here, 'capture-batch.mjs'), url, runFile, out, '--only', only, '--only-open', ...extra],
  { encoding: 'utf8', maxBuffer: 1 << 26 });
const lines = res.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
const sent = lines.filter((l) => l.status).map((l) => ({ n: l.n, screen: l.screen, captureId: jobs[l.n - 1].captureId, status: l.status }));
writeFileSync(path.join(out, 'sent.json'), JSON.stringify(sent, null, 1));
console.log(JSON.stringify(sent.map((s) => `${s.n} ${s.status} ${s.captureId}`)));
