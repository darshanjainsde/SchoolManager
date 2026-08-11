import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { getLibraryPlatformPrisma } from '@library/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { closeOrgLookupRedis } from '../src/modules/tenancy';
import { ENDPOINTS, type Role } from './endpoints';
import { LIVE, cleanupOrgs, seedTwoOrgs, seedLogins, type SeededOrg } from './helpers/live-db';
import { REFRESH_GRACE_REPLAY_CAP } from '../src/modules/auth/internal/refresh.service';

const ROLES: Role[] = ['ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER'];
const describeLive = LIVE ? describe : describe.skip;

describeLive('authz matrix — every role against every endpoint', () => {
  let app: INestApplication;
  let orgA: SeededOrg;
  let orgB: SeededOrg;
  let tokens: Record<Role, string>;
  const host = (o: SeededOrg) => `${o.slug}.library.trackyour.in`;

  beforeAll(async () => {
    // This suite hits real HTTP routes (login up to ROLES.length+1 times,
    // refresh ROLES.length times — see below). Throttling itself has its own
    // dedicated suite (throttle-identity.e2e.spec.ts); leaving the real
    // limiter engaged here would make this suite flaky/order-dependent
    // against a real Redis whose window outlives one test run. Restored in
    // afterAll so it never leaks into a different spec file sharing this
    // --runInBand process.
    process.env.DISABLE_THROTTLER = 'true';

    ({ orgA, orgB } = await seedTwoOrgs(Date.now().toString(36)));
    tokens = await seedLogins(orgA.id);
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    // /auth/login and /auth/refresh are `anonymous: true` rows: the per-role
    // loop below sends each role's bearer token and asserts a NON-401/403
    // response, to prove these routes are reachable regardless of which
    // (irrelevant, since neither route checks it) token is attached. That
    // assertion is only meaningful if the request body itself would
    // otherwise succeed — a deliberately-wrong password/refresh token
    // returns 401 from AuthService/RefreshService's own business logic
    // regardless of any guard, which would be indistinguishable from a
    // guard rejection and make the row untestable as written. So: seed one
    // real user with known credentials, log in for real once, and swap
    // these two rows' `body` for a real login and a real freshly-minted
    // refresh token before the per-role loop runs.
    const probePassword = 'authz-matrix-probe-Pw1!';
    const probe = await getLibraryPlatformPrisma().libUser.create({
      data: {
        orgId: orgA.id,
        email: `authz-matrix-probe-${Date.now().toString(36)}@matrix.test`,
        passwordHash: await argon2.hash(probePassword, { type: argon2.argon2id }),
        role: 'MEMBER',
        branchIds: [],
        active: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Library-Host', host(orgA))
      .send({ identifier: probe.email, password: probePassword });
    if (loginRes.status >= 400) {
      throw new Error(`authz-matrix setup: probe login failed (${loginRes.status}): ${JSON.stringify(loginRes.body)}`);
    }

    const loginEp = ENDPOINTS.find((e) => e.method === 'POST' && e.path === '/auth/login');
    if (loginEp) loginEp.body = { identifier: probe.email, password: probePassword };

    const refreshEp = ENDPOINTS.find((e) => e.method === 'POST' && e.path === '/auth/refresh');
    if (refreshEp) {
      // Refresh tokens are single-use with a short grace window
      // (RefreshService: REFRESH_GRACE_MS / REFRESH_GRACE_REPLAY_CAP) —
      // replaying the SAME raw token within the window mints a fresh child
      // rather than failing, up to REFRESH_GRACE_REPLAY_CAP times. ROLES has
      // exactly 4 entries: 1 normal rotation + REFRESH_GRACE_REPLAY_CAP
      // grace replays covers all 4 role iterations below with no spare and
      // no shortfall. If either constant changes, this needs revisiting —
      // asserted explicitly so a drift fails loudly here instead of as a
      // confusing flake in the per-role loop.
      expect(ROLES.length).toBe(REFRESH_GRACE_REPLAY_CAP + 1);
      refreshEp.body = { refreshToken: loginRes.body.refreshToken };
    }
  });

  afterAll(async () => {
    delete process.env.DISABLE_THROTTLER;
    await app?.close();
    await closeOrgLookupRedis();
    await cleanupOrgs([orgA.id, orgB.id]);
  });

  it('covers every registered route', () => {
    const server = app.getHttpAdapter().getInstance();
    const registered: string[] = [];
    for (const layer of server._router?.stack ?? []) {
      if (!layer.route) continue;
      for (const m of Object.keys(layer.route.methods)) {
        registered.push(`${m.toUpperCase()} ${layer.route.path}`);
      }
    }
    const listed = new Set(ENDPOINTS.map((e) => `${e.method} ${e.path}`));
    const missing = registered.filter((r) => !listed.has(r));
    expect(missing).toEqual([]); // add the endpoint to test/endpoints.ts
  });

  for (const ep of ENDPOINTS) {
    for (const role of ROLES) {
      const allowed = ep.anonymous || ep.roles.includes(role);
      it(`${ep.method} ${ep.path} — ${role} is ${allowed ? 'allowed' : 'denied'}`, async () => {
        const res = await request(app.getHttpServer())
          [ep.method.toLowerCase() as 'get'](ep.path)
          .set('X-Library-Host', host(orgA))
          .set('Authorization', `Bearer ${tokens[role]}`)
          .send(ep.body ?? {});
        if (allowed) expect([401, 403]).not.toContain(res.status);
        else expect([401, 403]).toContain(res.status);
      });
    }

    if (!ep.anonymous) {
      it(`${ep.method} ${ep.path} — rejects a token with no bearer at all`, async () => {
        const res = await request(app.getHttpServer())
          [ep.method.toLowerCase() as 'get'](ep.path)
          .set('X-Library-Host', host(orgA))
          .send(ep.body ?? {});
        expect([401, 403]).toContain(res.status);
      });

      it(`${ep.method} ${ep.path} — rejects org A's token against org B's host`, async () => {
        const res = await request(app.getHttpServer())
          [ep.method.toLowerCase() as 'get'](ep.path)
          .set('X-Library-Host', host(orgB))
          .set('Authorization', `Bearer ${tokens.LIBRARIAN}`)
          .send(ep.body ?? {});
        expect([401, 403]).toContain(res.status);
      });
    }
  }
});
