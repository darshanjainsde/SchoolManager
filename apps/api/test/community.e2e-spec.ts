/**
 * COMMUNITY / CONNECT-EVENTS E2E — requires a SEPARATELY BOOTED API on localhost:3001.
 *
 * These tests call the running API over HTTP.  The test's own Prisma client MUST
 * target the SAME database as that API.
 * Locally: boot the API against the dev DB and run jest with
 *   DATABASE_URL_TEST=postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public
 * In CI: boot the API against skoolos_test and omit DATABASE_URL_TEST.
 *
 * Seeded schools used here:
 *   beacon  (PRO,      LIVE) — "Beacon Public School"  — has EVENTS
 *   acme    (STANDARD, LIVE) — "Acme International"    — has EVENTS
 *
 * What this suite proves:
 *   1. School creates a SCHOOL-scope event → APPROVED; appears on own public site (isHost:true, originSchoolName:null).
 *   2. School submits NETWORK event → PENDING; NOT visible on another school's public site.
 *   3. Owner approves → NETWORK event now visible cross-school (isHost:false, scope:'NETWORK', originSchoolName set).
 *   4. EVENTS gating: throwaway BASIC school → GET /public/site events:[], POST /manage/events → 403.
 *   5. Isolation: acme admin cannot PATCH or DELETE beacon's event (RLS → 404).
 *   6. Owner creates a network event for beacon → auto-APPROVED; appears on acme's public site.
 */

import { getPlatformPrisma, disconnectAll } from '@skoolos/db';
import Redis from 'ioredis';
import { describeLiveApi, LIVE_API_BASE } from './requires-live-api';

// Honour E2E_API_BASE. requires-live-api.ts has exported LIVE_API_BASE all
// along and all four suites ignored it, so pointing them at a purpose-booted
// API was impossible — they always hit whatever happened to hold :3001. That
// is the exact failure this file's own docstring warns about: a stale server
// on the wrong database answers /health and fails every assertion.
const BASE = LIVE_API_BASE;

/** Obtain a school-scoped JWT (school admins have no TOTP). */
async function schoolToken(slug: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Host': `${slug}.localhost`,
    },
    body: JSON.stringify({ email: `admin@${slug}.test`, password: 'Passw0rd!' }),
  });
  if (!res.ok) throw new Error(`Login failed for ${slug}: ${res.status} ${await res.text()}`);
  const body = await res.json() as { accessToken: string };
  return body.accessToken;
}

/** Obtain a platform owner JWT (TOTP required). */
async function ownerToken(): Promise<string> {
  const { authenticator } = await import('otplib');
  const res = await fetch(`${BASE}/owner/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': 'owner.localhost' },
    body: JSON.stringify({
      email: 'owner@skoolos.local',
      password: 'OwnerPassw0rd!',
      totp: authenticator.generate('AIRFGVZFLVAH6J2C'),
    }),
  });
  if (!res.ok) throw new Error(`Owner login failed: ${res.status} ${await res.text()}`);
  return (await res.json()).accessToken as string;
}

interface PublicEvent {
  id: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  startAt: string;
  endAt: string | null;
  venue: string | null;
  scope: 'SCHOOL' | 'NETWORK';
  originSchoolName: string | null;
  isHost: boolean;
}

interface PublicSiteBody {
  school: { name: string; tier: string; features: string[] };
  events: PublicEvent[];
  [k: string]: unknown;
}

/** GET /public/site for the given slug, returns the parsed body. */
async function getPublicSite(slug: string): Promise<PublicSiteBody> {
  const res = await fetch(`${BASE}/public/site`, {
    headers: { 'X-Forwarded-Host': `${slug}.localhost` },
  });
  if (!res.ok) throw new Error(`GET /public/site for ${slug} returned ${res.status}`);
  return res.json() as Promise<PublicSiteBody>;
}

// ─────────────────────────────────────────────────────────────────────────────

describeLiveApi('Community / Connect-Events e2e', () => {
  // Shared across tests in this describe block.
  let beaconSchoolEventId: string;    // Test 1 — SCHOOL-scope event
  let beaconNetworkEventId: string;   // Test 2/3 — NETWORK-scope event (needs moderation)
  let ownerCreatedEventId: string;    // Test 6 — owner-created network event
  let throwawaySlug: string;
  let throwawaySchoolId: string;
  let createdEventIds: string[] = [];  // track all event IDs for cleanup

  // Use far-future dates so events are always "upcoming".
  const futureStart = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // +30 days
  const futureEnd   = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(); // +31 days

  beforeAll(async () => {
    const ts = Date.now();
    throwawaySlug = `e2ec${ts}`;

    const db = getPlatformPrisma();
    const school = await db.school.create({
      data: {
        slug: throwawaySlug,
        name: 'E2E Community Throwaway',
        tier: 'BASIC',
        status: 'LIVE',
      },
    });
    throwawaySchoolId = school.id;

    // Minimal profile + homepage so /public/site returns 200.
    await db.schoolProfile.create({
      data: {
        schoolId: throwawaySchoolId,
        brandColorPrimary: '#000000',
        brandColorSecondary: '#ffffff',
      },
    });
    await db.homepageContent.create({
      data: {
        schoolId: throwawaySchoolId,
        headline: 'Community Throwaway',
      },
    });
    await db.grade.create({
      data: { schoolId: throwawaySchoolId, name: 'Grade 1', order: 0 },
    });
  });

  afterAll(async () => {
    const db = getPlatformPrisma();

    // Delete all events created during this suite.
    if (createdEventIds.length > 0) {
      await db.event.deleteMany({ where: { id: { in: createdEventIds } } }).catch(() => undefined);
    }

    // Delete throwaway school (cascades profile, homepage, grades).
    if (throwawaySchoolId) {
      await db.school.delete({ where: { id: throwawaySchoolId } }).catch(() => undefined);
    }

    // Flush Redis cache entries for the throwaway school.
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    try {
      await redis.del(`host:${throwawaySlug}.localhost`);
      if (throwawaySchoolId) await redis.del(`feat:${throwawaySchoolId}`);
    } catch { /* ignore */ } finally {
      await redis.quit();
    }

    await disconnectAll();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 1 — school publishes own SCHOOL-scope event → APPROVED immediately
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. SCHOOL-scope event — auto-approved, visible on own public site', () => {
    it('POST /manage/events {scope:"SCHOOL"} as beacon admin → 201 with status APPROVED', async () => {
      const token = await schoolToken('beacon');
      const res = await fetch(`${BASE}/manage/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: `E2E School Event ${Date.now()}`,
          description: 'A school-only event for e2e',
          startAt: futureStart,
          endAt: futureEnd,
          venue: 'Main Hall',
          scope: 'SCHOOL',
        }),
      });
      expect(res.status).toBe(201);
      const ev = await res.json() as { id: string; status: string; scope: string };
      expect(typeof ev.id).toBe('string');
      expect(ev.status).toBe('APPROVED');
      expect(ev.scope).toBe('SCHOOL');
      beaconSchoolEventId = ev.id;
      createdEventIds.push(ev.id);
    });

    it('GET /public/site beacon → events[] contains the SCHOOL event with isHost:true, originSchoolName:null', async () => {
      const body = await getPublicSite('beacon');
      expect(Array.isArray(body.events)).toBe(true);
      const ev = body.events.find((e) => e.id === beaconSchoolEventId);
      expect(ev).toBeDefined();
      expect(ev!.isHost).toBe(true);
      expect(ev!.originSchoolName).toBeNull();
      expect(ev!.scope).toBe('SCHOOL');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 2 — NETWORK submission is PENDING and NOT visible on another school
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. NETWORK event — PENDING, hidden from other schools', () => {
    it('POST /manage/events {scope:"NETWORK"} as beacon admin → 201 with status PENDING', async () => {
      const token = await schoolToken('beacon');
      const res = await fetch(`${BASE}/manage/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: `E2E Network Event ${Date.now()}`,
          description: 'A network-scope event needing approval',
          startAt: futureStart,
          endAt: futureEnd,
          venue: 'City Center',
          scope: 'NETWORK',
        }),
      });
      expect(res.status).toBe(201);
      const ev = await res.json() as { id: string; status: string; scope: string };
      expect(typeof ev.id).toBe('string');
      expect(ev.status).toBe('PENDING');
      expect(ev.scope).toBe('NETWORK');
      beaconNetworkEventId = ev.id;
      createdEventIds.push(ev.id);
    });

    it('GET /public/site acme → events[] does NOT contain the PENDING NETWORK event', async () => {
      const body = await getPublicSite('acme');
      expect(Array.isArray(body.events)).toBe(true);
      const ev = body.events.find((e) => e.id === beaconNetworkEventId);
      expect(ev).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 3 — owner approves → NETWORK event visible cross-school
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Owner approves NETWORK event → cross-school visibility', () => {
    it('PATCH /owner/events/:id {action:"APPROVE"} → 200', async () => {
      const token = await ownerToken();
      const res = await fetch(`${BASE}/owner/events/${beaconNetworkEventId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'owner.localhost',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'APPROVE' }),
      });
      expect(res.status).toBe(200);
      const ev = await res.json() as { status: string };
      expect(ev.status).toBe('APPROVED');
    });

    it('GET /public/site acme → now contains the APPROVED NETWORK event with correct shape', async () => {
      const body = await getPublicSite('acme');
      expect(Array.isArray(body.events)).toBe(true);
      const ev = body.events.find((e) => e.id === beaconNetworkEventId);
      expect(ev).toBeDefined();
      expect(ev!.isHost).toBe(false);
      expect(ev!.scope).toBe('NETWORK');
      expect(ev!.originSchoolName).toBe('Beacon Public School');
    });

    it('GET /public/site beacon → also contains the NETWORK event with isHost:true', async () => {
      const body = await getPublicSite('beacon');
      const ev = body.events.find((e) => e.id === beaconNetworkEventId);
      expect(ev).toBeDefined();
      expect(ev!.isHost).toBe(true);
      expect(ev!.scope).toBe('NETWORK');
    });

    // Editing an already-APPROVED NETWORK event must re-enter moderation — the
    // school admin cannot silently push new content live network-wide.
    it('PATCH /manage/events/:id on the APPROVED network event → re-enters PENDING, drops off other schools', async () => {
      const token = await schoolToken('beacon');
      const res = await fetch(`${BASE}/manage/events/${beaconNetworkEventId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: 'Edited After Approval' }),
      });
      expect(res.status).toBe(200);
      const ev = await res.json() as { status: string; title: string };
      expect(ev.title).toBe('Edited After Approval');
      expect(ev.status).toBe('PENDING');

      // No longer visible on another school until re-approved.
      const acme = await getPublicSite('acme');
      expect(acme.events.find((e) => e.id === beaconNetworkEventId)).toBeUndefined();

      // Re-approve so later tests (owner re-list, cleanup) see a consistent state.
      const otoken = await ownerToken();
      const reapprove = await fetch(`${BASE}/owner/events/${beaconNetworkEventId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'owner.localhost',
          Authorization: `Bearer ${otoken}`,
        },
        body: JSON.stringify({ action: 'APPROVE' }),
      });
      expect(reapprove.status).toBe(200);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 4 — EVENTS feature gating: BASIC school
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. EVENTS gating — BASIC tier school', () => {
    it('GET /public/site for BASIC throwaway school → 200, events:[]', async () => {
      const body = await getPublicSite(throwawaySlug);
      expect(body.school.tier).toBe('BASIC');
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.events).toHaveLength(0);
    });

    it('POST /manage/events for BASIC school → 403 (EVENTS feature not enabled)', async () => {
      // The throwaway BASIC school has no seeded admin — we assert via the feature
      // guard that even a platform-created school admin would be rejected.
      // We create a temporary admin user for this test.
      const db = getPlatformPrisma();
      // Must match the API's PasswordService (argon2id) — a bcrypt hash would
      // never verify, so login would fail before we could assert the 403 gate.
      const argon2 = (await import('argon2')).default;
      const hash = await argon2.hash('Passw0rd!', { type: argon2.argon2id });
      const adminUser = await db.user.create({
        data: {
          schoolId: throwawaySchoolId,
          email: `admin@${throwawaySlug}.test`,
          passwordHash: hash,
          role: 'SCHOOL_ADMIN',
        },
      });

      // No domain row needed: `<slug>.localhost` resolves to the tenant via the
      // subdomain slug-fallback in SchoolLookupService.

      try {
        const loginRes = await fetch(`${BASE}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-Host': `${throwawaySlug}.localhost`,
          },
          body: JSON.stringify({ email: `admin@${throwawaySlug}.test`, password: 'Passw0rd!' }),
        });
        expect(loginRes.status).toBe(201);
        const { accessToken } = await loginRes.json() as { accessToken: string };

        const postRes = await fetch(`${BASE}/manage/events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-Host': `${throwawaySlug}.localhost`,
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            title: 'Gated Event',
            startAt: futureStart,
            scope: 'SCHOOL',
          }),
        });
        expect(postRes.status).toBe(403);
      } finally {
        // Cleanup: remove the temp admin user we created for this test.
        await db.user.delete({ where: { id: adminUser.id } }).catch(() => undefined);
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 5 — Cross-tenant isolation (RLS): acme cannot modify beacon's event
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Isolation — acme admin cannot mutate beacon events (RLS → 404)', () => {
    it('PATCH /manage/events/:beaconEventId as acme admin → 404', async () => {
      const token = await schoolToken('acme');
      const res = await fetch(`${BASE}/manage/events/${beaconSchoolEventId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: 'Hijacked Title' }),
      });
      expect(res.status).toBe(404);
    });

    it('DELETE /manage/events/:beaconEventId as acme admin → 404', async () => {
      const token = await schoolToken('acme');
      const res = await fetch(`${BASE}/manage/events/${beaconSchoolEventId}`, {
        method: 'DELETE',
        headers: {
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${token}`,
        },
      });
      expect(res.status).toBe(404);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Test 6 — Owner creates network event for beacon → auto-APPROVED, visible everywhere
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Owner creates network event directly → auto-APPROVED, visible cross-school', () => {
    it('POST /owner/events {schoolId: beaconId, ...} → 201 with status APPROVED', async () => {
      const token = await ownerToken();
      // Look up beacon's schoolId from the DB.
      const db = getPlatformPrisma();
      const beacon = await db.school.findUniqueOrThrow({ where: { slug: 'beacon' }, select: { id: true } });

      const res = await fetch(`${BASE}/owner/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'owner.localhost',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          schoolId: beacon.id,
          title: `E2E Owner-Created Network Event ${Date.now()}`,
          description: 'Created directly by owner',
          startAt: futureStart,
          endAt: futureEnd,
          venue: 'Platform HQ',
        }),
      });
      expect(res.status).toBe(201);
      const ev = await res.json() as { id: string; status: string; scope: string };
      expect(ev.status).toBe('APPROVED');
      expect(ev.scope).toBe('NETWORK');
      ownerCreatedEventId = ev.id;
      createdEventIds.push(ev.id);
    });

    it('GET /public/site acme → contains the owner-created NETWORK event', async () => {
      const body = await getPublicSite('acme');
      expect(Array.isArray(body.events)).toBe(true);
      const ev = body.events.find((e) => e.id === ownerCreatedEventId);
      expect(ev).toBeDefined();
      expect(ev!.isHost).toBe(false);
      expect(ev!.scope).toBe('NETWORK');
    });

    it('GET /public/site beacon → contains the owner-created event with isHost:true', async () => {
      const body = await getPublicSite('beacon');
      const ev = body.events.find((e) => e.id === ownerCreatedEventId);
      expect(ev).toBeDefined();
      expect(ev!.isHost).toBe(true);
    });
  });
});
