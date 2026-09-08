#!/usr/bin/env node
/** Verifies every repo path cited in the curated references still exists. Exit 1 on any miss. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = argOf('--root') ?? execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const REFS = join(here, '..', 'references');
const files = [join(here, '..', 'SKILL.md'), ...readdirSync(REFS).filter((f) => f.endsWith('.md')).map((f) => join(REFS, f))];
let missing = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/`((?:apps|packages|docs|scripts|\.github|\.claude)\/[^`\s:]+)`/g)) {
    const p = m[1].replace(/\/$/, '');
    // Globs and placeholders (`apps/*`, `modules/<name>`) describe a shape, not a file; the checker only
    // verifies concrete paths. Skill paths are checked against the repo copy too.
    if (/[*<>?]/.test(p)) continue;
    if (!existsSync(join(ROOT, p))) { missing++; console.log(`MISSING ${p}  (cited in ${f.split('/').slice(-2).join('/')})`); }
  }
}
console.log(missing ? `${missing} cited path(s) no longer exist — fix the references.` : 'all cited paths exist');
process.exit(missing ? 1 : 0);
