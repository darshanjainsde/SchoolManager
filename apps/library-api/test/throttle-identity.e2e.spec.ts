import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { closeOrgLookupRedis } from '../src/modules/tenancy';
import { LIVE, cleanupOrgs, seedTwoOrgs, type SeededOrg } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Proves `/auth/login` and `/auth/refresh` are throttled on IDENTITY, not
 * IP — the fix for the bug documented in `auth.controller.ts`'s `@Throttle`
 * comments: an IP-keyed bucket punishes an entire NAT'd school for one busy
 * morning, since many legitimate devices share one egress IP.
 *
 * Deliberately does NOT set `DISABLE_THROTTLER` (unlike authz-matrix.e2e.spec.ts,
 * which turns throttling off to stay independent of it) — throttling is
 * exactly what this suite exists to exercise, against the real
 * `RedisThrottlerStorage`.
 *
 * Every identifier/IP used below is randomised per test run specifically so
 * re-running this suite inside the SAME 15-minute Redis window (routine
 * during local iteration) starts every bucket fresh — a fixed IP or
 * identifier would accumulate hits across runs and make the "first N
 * succeed" assertions flake on a second run.
 */
describeLive('auth throttling is keyed on identity, not IP', () => {
  let app: INestApplication;
  let orgA: SeededOrg;
  const host = () => `${orgA.slug}.library.trackyour.in`;

  beforeAll(async () => {
    ({ orgA } = await seedTwoOrgs(Date.now().toString(36)));
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await closeOrgLookupRedis();
    await cleanupOrgs([orgA.id]);
  });

  const rand = () => Math.random().toString(36).slice(2, 10);
  const randomIp = () => `10.${1 + Math.floor(Math.random() * 253)}.${1 + Math.floor(Math.random() * 253)}.${1 + Math.floor(Math.random() * 253)}`;

  function login(identifier: string, ip: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Library-Host', host())
      .set('X-Forwarded-For', ip)
      .send({ identifier, password: 'wrong-on-purpose' });
  }

  function refresh(token: string, ip: string) {
    return request(app.getHttpServer())
      .post('/auth/refresh')
      .set('X-Library-Host', host())
      .set('X-Forwarded-For', ip)
      .send({ refreshToken: token });
  }

  describe('POST /auth/login — identity: 5 per 15 min per (org, identifier); default: 20 per 15 min per IP', () => {
    it('two different identifiers behind one IP do not share a bucket', async () => {
      const ip = randomIp();
      const identifierA = `throttle-a-${rand()}@matrix.test`;
      const identifierB = `throttle-b-${rand()}@matrix.test`;

      // Exhaust identifier A's 5-attempt identity bucket.
      for (let i = 0; i < 5; i++) {
        const res = await login(identifierA, ip);
        expect(res.status).not.toBe(429);
      }
      // The 6th attempt for A, same IP: identity bucket is now exhausted.
      const sixthA = await login(identifierA, ip);
      expect(sixthA.status).toBe(429);

      // Identifier B, SAME IP, first attempt: a fresh identity bucket — must
      // not be blocked by A's exhaustion. (The IP-keyed `default` throttler
      // is a separate, much looser 20/15min ceiling that one prior 6xx
      // request on this IP does not come close to.)
      const firstB = await login(identifierB, ip);
      expect(firstB.status).not.toBe(429);
    });

    it('the same identifier from two different IPs shares one bucket', async () => {
      const identifier = `throttle-shared-${rand()}@matrix.test`;
      const ip1 = randomIp();
      const ip2 = randomIp();

      // Exhaust the identity bucket entirely from ip1.
      for (let i = 0; i < 5; i++) {
        const res = await login(identifier, ip1);
        expect(res.status).not.toBe(429);
      }
      // Same identifier, a DIFFERENT IP: still blocked, because the identity
      // tracker never looked at the IP in the first place.
      const fromIp2 = await login(identifier, ip2);
      expect(fromIp2.status).toBe(429);
    });

    it('the IP ceiling still engages once 20 distinct identifiers exhaust it, independent of any single identity bucket', async () => {
      const ip = randomIp();
      // 20 distinct identifiers, one attempt each: no single identity bucket
      // (limit 5) ever gets anywhere near exhausted, so every block below is
      // attributable only to the IP-keyed `default` throttler (limit 20).
      for (let i = 0; i < 20; i++) {
        const res = await login(`throttle-ip-ceiling-${i}-${rand()}@matrix.test`, ip);
        expect(res.status).not.toBe(429);
      }
      const twentyFirst = await login(`throttle-ip-ceiling-21-${rand()}@matrix.test`, ip);
      expect(twentyFirst.status).toBe(429);
    });
  });

  describe('POST /auth/refresh — identity: keyed on a hash of the refresh token, not IP', () => {
    it('two different tokens behind one IP do not share a bucket', async () => {
      const ip = randomIp();
      // Tokens don't need to be valid — the identity tracker only hashes the
      // string; the throttler guard runs before the controller/service ever
      // looks the token up, so an invalid token still exercises the bucket.
      const tokenA = `throttle-refresh-a-${rand()}`;
      const tokenB = `throttle-refresh-b-${rand()}`;

      const firstA = await refresh(tokenA, ip);
      expect(firstA.status).not.toBe(429);
      // A second, different token from the SAME IP must not inherit any
      // state from token A's bucket.
      const firstB = await refresh(tokenB, ip);
      expect(firstB.status).not.toBe(429);
    });

    it('the same token from two different IPs shares one bucket', async () => {
      const token = `throttle-refresh-shared-${rand()}`;
      const ip1 = randomIp();
      const ip2 = randomIp();

      let last!: Awaited<ReturnType<typeof refresh>>;
      for (let i = 0; i < 30; i++) {
        last = await refresh(token, i % 2 === 0 ? ip1 : ip2);
        expect(last.status).not.toBe(429);
      }
      // The 31st use of the SAME token, from either IP, crosses the 30/min
      // identity limit — proving the bucket followed the token across IPs,
      // not the other way around.
      const overLimit = await refresh(token, ip1);
      expect(overLimit.status).toBe(429);
    });
  });
});
