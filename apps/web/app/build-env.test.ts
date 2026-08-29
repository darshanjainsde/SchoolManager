import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A BUILD MUST NOT INHERIT NODE_ENV.
 *
 * The repo's .env used to set NODE_ENV=development, and it gets sourced into
 * shells all day for the e2e suites, which need real database credentials. The
 * moment one of those shells runs a build, `next build` builds in development
 * mode and dies prerendering /404 with:
 *
 *   Error: <Html> should not be imported outside of pages/_document
 *
 * That message names a file nobody wrote and a router this repo does not use,
 * so it reads as the application being broken. It cost two wrong diagnoses in
 * a single build — apps/web, and then apps/library-web, which was reported to
 * the user as pre-existing breakage when it built perfectly well.
 *
 * The .env line is gone, but .env is gitignored and every existing checkout
 * still has it, and any future export can put it back. So the build pins the
 * value itself and this test keeps the pin there. Vercel already builds in
 * production, so the pin is a no-op in CI and a fix on every laptop.
 */
const APPS = ['apps/web', 'apps/library-web'];
const repoRoot = join(__dirname, '../../..');

describe('the build pins its own NODE_ENV', () => {
  it.each(APPS)('%s builds in production regardless of the shell', (app) => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, app, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toMatch(/NODE_ENV=production/);
  });

  it('does not put NODE_ENV back into .env.example', () => {
    const example = readFileSync(join(repoRoot, '.env.example'), 'utf8');
    const assignments = example
      .split('\n')
      .filter((l) => /^\s*NODE_ENV\s*=/.test(l));
    expect(assignments).toEqual([]);
  });
});
