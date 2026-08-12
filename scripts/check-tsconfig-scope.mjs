#!/usr/bin/env node
/**
 * Fails if any app's tsconfig pulls in workspace packages by wildcard.
 *
 * This has now broken two deploys in two different packages, the same way
 * both times. `"include": ["../../packages/*\/src/**\/*"]` sweeps in EVERY
 * package in the monorepo, including ones the app never imports — so adding
 * an unrelated package to the repo silently breaks this app's typecheck,
 * build, or ncc bundle:
 *
 *   - apps/api  — a sibling package's gitignored generated Prisma client
 *                 failed `ncc build` with TS2307. 15 preview deploys failed.
 *   - apps/worker — packages/library-db/src/test-live.ts (a jest helper)
 *                 failed typecheck AND build with TS2503 'Cannot find
 *                 namespace jest'.
 *
 * The fix each time was to list the packages literally. This guard is here so
 * there is no third time: a wildcard is caught locally, before the push, by
 * the same command that runs the rest of the gate.
 *
 * `exclude` patterns are deliberately NOT checked — a wildcard there only ever
 * removes files, so it cannot sweep anything in.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const appsDir = join(root, 'apps');

/**
 * Strips comments so JSON.parse accepts a tsconfig (they are JSONC).
 *
 * Scans character by character and tracks whether it is inside a string,
 * because a regex cannot: every glob in these files contains `/*`, so a naive
 * `/\/\*[\s\S]*?\*\//g` deletes from inside `"src/**\/*"` onward and corrupts
 * the document. That produced four bogus "could not be parsed" offenders on
 * the first run of this guard.
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  let inString = false;

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    if (inString) {
      out += c;
      if (c === '\\') { out += next ?? ''; i += 2; continue; }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }

    if (c === '"') { inString = true; out += c; i += 1; continue; }
    if (c === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Also tolerates trailing commas, which tsconfigs are allowed to carry. */
function parseJsonc(text) {
  return JSON.parse(stripComments(text).replace(/,(\s*[}\]])/g, '$1'));
}

const offenders = [];
let checked = 0;

for (const app of readdirSync(appsDir)) {
  for (const name of ['tsconfig.json', 'tsconfig.build.json']) {
    const file = join(appsDir, app, name);
    if (!existsSync(file)) continue;

    let config;
    try {
      config = parseJsonc(readFileSync(file, 'utf8'));
    } catch (err) {
      offenders.push(`${relative(root, file)} — could not be parsed: ${err.message}`);
      continue;
    }
    checked += 1;

    for (const pattern of config.include ?? []) {
      if (/packages\/\*/.test(pattern)) {
        offenders.push(
          `${relative(root, file)} — include "${pattern}" sweeps in every workspace package. ` +
            `List the packages this app actually imports, literally.`,
        );
      }
    }
  }
}

// A guard that checked nothing would pass silently and be worse than absent.
if (checked === 0) {
  console.error('✗ tsconfig scope: found no app tsconfigs to check — the guard is not looking where it thinks.');
  process.exit(1);
}

if (offenders.length > 0) {
  console.error('✗ tsconfig scope: workspace packages must be listed literally, never by wildcard.\n');
  for (const o of offenders) console.error(`  ${o}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ tsconfig scope: ${checked} app tsconfig(s), no packages/* wildcards.`);
