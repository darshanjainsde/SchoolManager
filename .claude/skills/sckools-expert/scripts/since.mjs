#!/usr/bin/env node
/** Lists commits and touched areas since the last inventory stamp, mapped to the reference files to refresh. */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = argOf('--root') ?? execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const statePath = join(here, '..', 'references', 'inventory', 'STATE.json');
const since = argOf('--since') ?? (existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')).sha : '');
if (!since) { console.log('No previous stamp — run inventory.mjs first, or pass --since <sha>.'); process.exit(0); }
const sh = (c) => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };
const AREAS = [
  [/^packages\/db\/prisma\//, 'architecture.md (data), inventory/data-model.md, inventory/migrations.md'],
  [/^apps\/api\/src\/modules\/(cms|public)\//, 'feature-catalog.md (Website & public site)'],
  [/^apps\/api\/src\/modules\/management\//, 'feature-catalog.md (Management) — and the behaviour spec'],
  [/^apps\/api\/src\/modules\/(fees|press|library|hiring|alumni|blog|community|portal|marketing|owner|auth|tenancy|features)\//, 'feature-catalog.md, architecture.md'],
  [/^apps\/api\/src\/common\//, 'conventions.md, architecture.md'],
  [/^apps\/web\/app\/app\//, 'feature-catalog.md (admin console)'],
  [/^apps\/web\/app\/(portal|teacher)\//, 'feature-catalog.md (portals)'],
  [/^apps\/web\/components\/public\//, 'feature-catalog.md (Website studio / public site)'],
  [/^apps\/web\/(components\/marketing|public\/site-preview|app\/page\.tsx|app\/pricing|next\.config\.mjs)/, 'business.md (marketing site)'],
  [/^apps\/mobile\//, 'feature-catalog.md (mobile), inventory/mobile-routes.md'],
  [/^(\.github\/workflows|scripts\/|vercel\.json|apps\/web\/vercel\.json|apps\/api\/vercel\.json)/, 'operations.md, inventory/workflows.md'],
  [/^docs\//, 'inventory/docs-index.md (and whatever the doc describes)'],
  [/^apps\/library-|^packages\/library-/, 'architecture.md (library service)'],
];
const log = sh(`git log --no-merges --format='%h %ad %s' --date=short ${since}..HEAD`);
const files = sh(`git diff --name-only ${since}..HEAD`).split('\n').filter(Boolean);
console.log(`Commits since ${since.slice(0, 7)}:\n${log || '(none)'}\n`);
const hits = new Map();
for (const f of files) for (const [re, target] of AREAS) if (re.test(f)) (hits.get(target) ?? hits.set(target, []).get(target)).push(f);
console.log(`Files changed: ${files.length}\n`);
for (const [target, fs] of hits) console.log(`→ refresh ${target}\n${fs.slice(0, 12).map((f) => `    ${f}`).join('\n')}${fs.length > 12 ? `\n    … +${fs.length - 12} more` : ''}\n`);
const unmapped = files.filter((f) => !AREAS.some(([re]) => re.test(f)));
if (unmapped.length) console.log(`Unmapped (decide by hand):\n${unmapped.slice(0, 20).map((f) => `    ${f}`).join('\n')}`);
