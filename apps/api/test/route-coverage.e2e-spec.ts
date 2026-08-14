import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { disconnectAll } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { AUTHZ_REVIEWED, AUTHZ_UNREVIEWED } from './route-manifest';

/**
 * Every mounted route must be accounted for.
 *
 * `apps/library-api` has had this since Phase 1a — it enumerates its own
 * routes and fails if one is not covered by its authz matrix. `apps/api` had
 * NOTHING equivalent: `management-authz.e2e-spec.ts` is a hand-written list, so
 * a new controller was caught by nobody unless someone remembered to add a
 * case.
 *
 * That is not hypothetical. `StaffController` shipped with `RolesGuard` on two
 * handlers and none on the other four, and a STUDENT token could read the staff
 * roster and DELETE a staff record. Nothing failed. It was found by reading the
 * file, months later, while adding an unrelated role.
 *
 * So this test does not check that authorization is CORRECT — no static check
 * can. It checks that every route has been LOOKED AT, which is the property
 * whose absence let that survive. A new route lands in neither list and turns
 * this red, and the fix is to decide which list it belongs in.
 *
 * `AUTHZ_UNREVIEWED` is a baseline of what already existed, and it may only
 * ever shrink. Adding to it is allowed exactly once — when this test is
 * introduced — and is a deliberate, visible debt rather than a silent gap.
 */
describe('route authorization coverage', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  function mountedRoutes(): string[] {
    const server = app.getHttpAdapter().getInstance();
    const routes: string[] = [];
    for (const layer of server._router?.stack ?? []) {
      if (!layer.route) continue;
      // `app.use()` middleware registers as a route on path '/*' under EVERY
      // http verb Express knows — 30-odd of them, ACL and MKCALENDAR included.
      // They are not endpoints and nobody can authorize them; leaving them in
      // buries the real table under noise and makes the manifest unreadable.
      if (layer.route.path === '/*' || layer.route.path === '*') continue;
      for (const method of Object.keys(layer.route.methods)) {
        routes.push(`${method.toUpperCase()} ${layer.route.path}`);
      }
    }
    return routes;
  }

  it('enumerates a non-empty route table', () => {
    // Regenerating the baseline is a real, occasional need (a big refactor
    // renames a prefix), and doing it by hand from a jest diff is how a list
    // like this acquires typos. `DUMP_ROUTES=<path> pnpm --filter @skoolos/api
    // test:e2e -- route-coverage` writes the current table; nothing writes
    // anything without it.
    if (process.env.DUMP_ROUTES) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('node:fs').writeFileSync(
        process.env.DUMP_ROUTES,
        JSON.stringify(mountedRoutes().sort(), null, 2),
      );
    }
    // Without this the whole suite is vacuous. `server._router` is an Express
    // internal — Express 5 already renames it — and the `?? []` fallback would
    // silently make every assertion below trivially true, a test that passes
    // HAVING CHECKED NOTHING. Same failure mode the RLS coverage audit guards
    // with its own `tablesChecked` count.
    expect(mountedRoutes().length).toBeGreaterThan(50);
  });

  it('has every mounted route in exactly one of the two lists', () => {
    const known = new Set([...AUTHZ_REVIEWED, ...AUTHZ_UNREVIEWED]);
    const unaccounted = mountedRoutes().filter((r) => !known.has(r));

    // If this fails: your new route is not in test/route-manifest.ts. Decide
    // who may call it, add an assertion to management-authz.e2e-spec.ts, and
    // put it in AUTHZ_REVIEWED. Do NOT put a new route in AUTHZ_UNREVIEWED —
    // that list is a record of what predates this guard, and it only shrinks.
    expect(unaccounted).toEqual([]);
  });

  it('lists no route twice, in both buckets', () => {
    const overlap = AUTHZ_REVIEWED.filter((r) => AUTHZ_UNREVIEWED.includes(r));
    expect(overlap).toEqual([]);
  });

  it('does not claim to cover routes that no longer exist', () => {
    // A manifest that outlives its routes rots into noise, and the next reader
    // stops trusting any of it.
    const mounted = new Set(mountedRoutes());
    const stale = [...AUTHZ_REVIEWED, ...AUTHZ_UNREVIEWED].filter((r) => !mounted.has(r));
    expect(stale).toEqual([]);
  });
});
