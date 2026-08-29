/**
 * Four suites here are SMOKE TESTS against a separately booted API on :3001,
 * not in-process tests of the Nest app. They each say so at the top of the
 * file, and they fail with twenty-odd assertion errors when the API is absent
 * or pointed somewhere else — which, in a terminal, is indistinguishable from
 * the product being broken.
 *
 * That is how they came to sit red long enough to be dismissed as
 * "pre-existing failures", and that is the real cost: a suite that cries wolf
 * over a missing prerequisite trains everybody to stop reading it.
 *
 * The precondition is NOT "something is listening on 3001". A healthy API on
 * the wrong database answers /health perfectly and then fails every assertion,
 * which is precisely what a stale dev server left running from yesterday does
 * — a shape this repo has been bitten by before. Probing cannot distinguish
 * the two, so the opt-in is explicit:
 *
 *     DATABASE_URL=postgresql://skoolos:skoolos@localhost:5432/skoolos_test?schema=public \
 *       pnpm --filter @skoolos/api start:dev
 *     E2E_LIVE_API=1 pnpm --filter @skoolos/api test:e2e
 *
 * Without that flag these suites SKIP, and the rest of the run is honestly
 * green rather than noisily red.
 */
const ENABLED = process.env.E2E_LIVE_API === '1';

if (!ENABLED && !process.env.E2E_QUIET) {
  // eslint-disable-next-line no-console
  console.log(
    '\n  ⏭  Live-API suites skipped (student, public, owner, community).\n'
    + '     They need an API booted against skoolos_test, not just any API on :3001 —\n'
    + '     a stale server on the dev database passes /health and fails everything else.\n'
    + '     Boot one, then re-run with E2E_LIVE_API=1.\n',
  );
}

/** `describe` when the live-API suites are explicitly enabled, else `describe.skip`. */
export const describeLiveApi: jest.Describe = ENABLED ? describe : describe.skip;
export const LIVE_API_BASE = process.env.E2E_API_BASE ?? 'http://localhost:3001';
