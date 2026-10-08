#!/usr/bin/env node
// Creates your personal config from the documented example, once. Never overwrites it.
//
//   node setup.mjs            create ~/.proto-handoff/config.jsonc if missing, then validate it
//   node setup.mjs --path     print where the config lives
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configPath, loadConfig, ConfigError } from './lib/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const example = path.join(here, '..', 'config.example.jsonc');
const file = configPath();

if (process.argv.includes('--path')) { console.log(file); process.exit(0); }

if (existsSync(file)) {
  console.log(`Config already exists (left untouched): ${file}`);
} else {
  mkdirSync(path.dirname(file), { recursive: true });
  copyFileSync(example, file);
  console.log(`Created ${file} from config.example.jsonc. Every line is optional; edit it with any text editor.`);
}
try {
  const { config, warnings } = loadConfig({ file });
  console.log(`Config is valid. Work folders go to ${config.workRoot}`);
  for (const w of warnings) console.log(`Warning: ${w}`);
} catch (e) {
  if (e instanceof ConfigError) { console.error(e.message); process.exit(1); }
  throw e;
}
