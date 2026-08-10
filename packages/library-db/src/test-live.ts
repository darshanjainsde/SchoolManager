/**
 * Shared "does this suite have a real database" gate for live-only specs in
 * this package (today: rls-audit.spec.ts — any future spec that needs a
 * real Postgres should import from here too, not reinvent this check).
 *
 * A skip is fine on a laptop with no docker stack running. In CI, a skip is
 * a FALSE GREEN: the suite reports nothing, jest exits 0, and nobody
 * notices the thing it was meant to catch. That is exactly how the RLS
 * coverage audit's three live tests silently never ran in CI (Task 12
 * review, finding 2) — no failure, no warning, just quiet absence. So:
 * outside CI, a missing LIBRARY_DATABASE_URL_PLATFORM means skip (today's
 * behaviour, unchanged); inside CI (`process.env.CI`, set by GitHub Actions
 * and effectively every other CI runner), the same missing var means this
 * whole file throws at import time — a loud, named suite failure instead of
 * a silent skip.
 */
export const LIVE = Boolean(process.env.LIBRARY_DATABASE_URL_PLATFORM);

if (!LIVE && process.env.CI) {
  throw new Error(
    'LIBRARY_DATABASE_URL_PLATFORM is not set while process.env.CI is set. ' +
      'A live-only suite must not silently skip in CI — provision a database ' +
      'for this job and set LIBRARY_DATABASE_URL_PLATFORM, or this file should ' +
      'not be running in this job at all.',
  );
}

export const describeLive: jest.Describe = LIVE ? describe : describe.skip;
