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


/**
 * Second check, same script, same reason: a config-level fault that no local
 * build catches and that fails the ENTIRE deployment.
 *
 * Vercel validates vercel.json at deploy-creation time and rejects the whole
 * deployment when it fails — not the offending route, everything. This repo
 * has lost 15 preview deploys to one config fault already, and a sub-daily
 * cron once rejected a whole deployment on its own. So: the file must parse as
 * strict JSON (no comments — unlike tsconfig, this one is not JSONC), and any
 * cron must be daily or slower, because a Hobby plan rejects the deployment
 * outright rather than just disabling the cron.
 */
function checkVercelConfigs() {
  const problems = [];
  let seen = 0;

  for (const app of readdirSync(appsDir)) {
    const file = join(appsDir, app, 'vercel.json');
    if (!existsSync(file)) continue;
    seen += 1;

    const text = readFileSync(file, 'utf8');
    let config;
    try {
      config = JSON.parse(text); // strict: comments are NOT valid here
    } catch (err) {
      problems.push(`${relative(root, file)} — not strict JSON: ${err.message}`);
      continue;
    }

    for (const cron of config.crons ?? []) {
      // "m h ..." — anything with a step or a list in the first two fields runs
      // more than once a day.
      const [minute = '', hour = ''] = String(cron.schedule ?? '').split(/\s+/);
      const subDaily = hour.includes('*') || hour.includes('/') || hour.includes(',') || minute.includes('/');
      if (subDaily) {
        problems.push(
          `${relative(root, file)} — cron "${cron.schedule}" runs more than daily. ` +
            `A Hobby plan rejects the ENTIRE deployment for this, not just the cron.`,
        );
      }
    }
  }

  return { problems, seen };
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

const vercel = checkVercelConfigs();
if (vercel.problems.length > 0) {
  console.error('✗ vercel.json: a config fault here fails the WHOLE deployment.\n');
  for (const p of vercel.problems) console.error(`  ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ tsconfig scope: ${checked} app tsconfig(s), no packages/* wildcards.`);
console.log(`✓ vercel.json: ${vercel.seen} config(s), strict JSON, no sub-daily crons.`);
