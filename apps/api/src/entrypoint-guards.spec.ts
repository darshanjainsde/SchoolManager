import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Both entrypoints must run the tenant-isolation check.
 *
 * It was added to src/main.ts alone, which binds a port and is the LOCAL
 * entrypoint. Vercel bundles server.ts (`ncc build server.ts`, see
 * package.json), so the guard never ran in staging or production — the only
 * two places holding real schools' data. A check that runs only where it is
 * not needed is worse than none, because it reads as covered.
 */
const apiRoot = resolve(__dirname, '..');

const ENTRYPOINTS = ['server.ts', 'src/main.ts'];

describe('every API entrypoint verifies tenant isolation at boot', () => {
  it.each(ENTRYPOINTS)('%s calls assertTenantIsolationEnforced', (file) => {
    const src = readFileSync(resolve(apiRoot, file), 'utf8');
    expect(src).toContain('assertTenantIsolationEnforced');
  });

  it.each(ENTRYPOINTS)('%s awaits it, rather than firing and forgetting', (file) => {
    const src = readFileSync(resolve(apiRoot, file), 'utf8');
    expect(src).toMatch(/await\s+assertTenantIsolationEnforced/);
  });

  it('the bundler entry is the file we think it is', () => {
    // If `bundle` ever points somewhere else, the list above is stale and
    // these assertions stop covering what actually deploys.
    const pkg = JSON.parse(readFileSync(resolve(apiRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts.bundle).toContain('server.ts');
  });

  it('only relaxes the check outside production', () => {
    for (const file of ENTRYPOINTS) {
      const src = readFileSync(resolve(apiRoot, file), 'utf8');
      expect(src).toMatch(/allowBypass:\s*env\.NODE_ENV\s*!==\s*'production'/);
    }
  });
});
