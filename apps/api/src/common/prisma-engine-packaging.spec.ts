import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The library module shipped to staging and answered 500 on EVERY route:
 *
 *   Prisma Client could not locate the Query Engine for runtime
 *   "rhel-openssl-3.0.x" ... the bundler has not copied
 *   "libquery_engine-rhel-openssl-3.0.x.so.node" next to the resulting bundle.
 *
 * Nothing local reproduced it. The whole test suite was green, because the
 * lambda's filesystem is the one thing no test on this machine has. The gap is
 * structural: `deref-pnpm-symlinks.mjs` stages the engine at build time and
 * `vercel.json` decides what survives into the bundle, and those two files had
 * drifted apart with no check between them — the same shape as the feature-key
 * and staff-role drift, where one copy of a list was fixed and the other was
 * left to fail later and further away.
 *
 * This cannot assert the engine loads (that needs the lambda). It CAN assert
 * the two halves still agree, which is the part that broke. Both files are read
 * as TEXT: the script is ESM with side effects that would run on import, and
 * vercel.json is consumed by Vercel, not by us.
 */
const apiRoot = resolve(__dirname, '../..');
const scriptSrc = readFileSync(resolve(apiRoot, 'scripts/deref-pnpm-symlinks.mjs'), 'utf8');
const vercelJson = JSON.parse(readFileSync(resolve(apiRoot, 'vercel.json'), 'utf8'));

const BINARY = 'libquery_engine-rhel-openssl-3.0.x.so.node';

/**
 * The `engineTargets` array from the script, as paths relative to apps/api
 * (which is the Vercel project root, and what `includeFiles` globs resolve
 * against).
 */
function engineTargets(): string[] {
  const start = scriptSrc.indexOf('const engineTargets = [');
  if (start === -1) throw new Error('engineTargets declaration not found');
  const body = scriptSrc.slice(start, scriptSrc.indexOf('];', start));
  return [...body.matchAll(/`apps\/api\/([^`]*)\$\{BINARY\}`/g)].map((m) => `${m[1]}${BINARY}`);
}

/** Expands the one brace group `includeFiles` uses, e.g. `{a/,b/}x` → [`a/x`, `b/x`]. */
function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];
  const close = pattern.indexOf('}', open);
  if (close === -1) throw new Error(`unbalanced brace in includeFiles: ${pattern}`);
  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  return pattern
    .slice(open + 1, close)
    .split(',')
    .map((alt) => `${prefix}${alt}${suffix}`);
}

function includedFiles(): string[] {
  const include = vercelJson.functions?.['api/index.js']?.includeFiles;
  if (!include) throw new Error('functions["api/index.js"].includeFiles not set');
  return (Array.isArray(include) ? include : [include]).flatMap(expandBraces);
}

describe('the Prisma query engine reaches the lambda', () => {
  it('stages the engine somewhere, and names every target', () => {
    // A silently-empty parse would make every assertion below vacuously true —
    // which is how the staff-role guard nearly shipped useless.
    expect(engineTargets().length).toBeGreaterThan(0);
    expect(includedFiles().length).toBeGreaterThan(0);
  });

  it('includeFiles ships EVERY path the build script writes', () => {
    // A staged copy that vercel.json does not name is made at build time and
    // then dropped from the bundle — invisible in the build log, fatal at
    // runtime, and only for the client whose engine went missing.
    const included = new Set(includedFiles());
    for (const target of engineTargets()) {
      expect(included).toContain(target);
    }
  });

  it('covers the directories the failing client actually searched', () => {
    // Read verbatim off the runtime log of the 500. `/var/task` is the project
    // root, so these are the relative paths that land on the searched ones.
    // Dropping any of them re-opens the exact failure.
    const included = new Set(includedFiles());
    expect(included).toContain(`generated/client/${BINARY}`);
    expect(included).toContain(`.prisma/client/${BINARY}`);
    expect(included).toContain(`apps/api/${BINARY}`);
  });

  it('does not include a path that escapes the project root', () => {
    // The original value was `../libquery_engine-...`, which resolves ABOVE
    // apps/api. Vercel matched nothing and said nothing; the Sckools engine
    // only ever arrived because nft traced it through node_modules. A silent
    // no-op that looks like coverage is worse than no line at all.
    for (const file of includedFiles()) {
      expect(file.startsWith('..')).toBe(false);
    }
  });

  it('installs both Prisma clients before the build reads their types', () => {
    // @library/db generates to a custom output directory; without this the
    // bundle compiled against empty types and failed the cloud build.
    expect(vercelJson.installCommand).toContain('@library/db generate');
    expect(vercelJson.installCommand).toContain('@skoolos/db generate');
    expect(vercelJson.installCommand).toContain('deref-pnpm-symlinks.mjs');
  });
});
