import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * GUARD: nothing under apps/api/src imports from '@prisma/client' directly —
 * not services, not specs.
 *
 * Every local gate passes such an import (tsc, jest, even a local ncc bundle:
 * node_modules holds the generated client). Only the CLOUD build fails, where
 * '@prisma/client' resolves to an ungenerated stub with no `Prisma` namespace
 * and no model types — "TS2305: Module '@prisma/client' has no exported member
 * 'Prisma'" — and the deploy goes red after preflight said green. The ncc
 * bundle type-checks spec files too, so a spec is as fatal as a service.
 * Fourth occurrence (ledger: prisma-types-imported-from-prisma-client).
 *
 * The workspace wrapper re-exports the whole client: `import { Prisma, type
 * StudentStatus } from '@skoolos/db'`. A spec that needs the real namespace
 * inside a mock factory uses `jest.requireActual('@prisma/client')` — a
 * runtime require the bundler never type-checks — which this guard allows.
 */
const SRC = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const STATIC_IMPORT = /^\s*import\s[^;]*?\sfrom\s+['"]@prisma\/client['"]/m;
const TYPE_IMPORT = /import\(\s*['"]@prisma\/client['"]\s*\)/;

describe('no file under apps/api/src imports @prisma/client directly', () => {
  const files = walk(SRC);

  it('scans a realistic number of files (the guard is not silently empty)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('uses the @skoolos/db wrapper (or jest.requireActual in a mock) instead', () => {
    const offenders = files
      .filter((f) => !f.endsWith('prisma-client-imports.spec.ts'))
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        return STATIC_IMPORT.test(src) || TYPE_IMPORT.test(src);
      })
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
