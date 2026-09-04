/**
 * PUBLIC API E2E — requires a SEPARATELY BOOTED API on localhost:3001.
 *
 * These tests call the running API over HTTP, so any Prisma usage here MUST
 * target the SAME database as that API.
 * Locally: boot the API against the dev DB and run jest with
 *   DATABASE_URL_TEST=postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public
 * In CI: boot the API against skoolos_test and omit DATABASE_URL_TEST.
 *
 * Seeded credentials used here:
 *   acme admin:   admin@acme.test   / Passw0rd!  host: acme.localhost   tier: STANDARD
 *   beacon admin: admin@beacon.test / Passw0rd!  host: beacon.localhost  tier: PRO
 *
 * Proved by this suite:
 *   1. GET /public/site — host resolution: beacon (PRO) + acme (STANDARD) → 200 with correct shape.
 *   2. 404 for platform host (owner.localhost) and unknown host (nope.localhost).
 *   3. Feature gating: throwaway BASIC school → homepage.aboutText === null, profile contact null
 *      (ABOUT_CONTACT is excluded from BASIC tier).
 *      Approach: created fresh BASIC school; no feat: Redis cache exists yet → DB returns BASIC tier
 *      features which exclude ABOUT_CONTACT. No manual cache flush needed.
 *   4. Suspended school → 404: throwaway school set to SUSPENDED via getPlatformPrisma, then
 *      Redis host cache key host:<hostname> flushed (deterministic: forces fresh DB lookup which
 *      also checks school.status; even without flush the PublicSiteService.getSite() DB check
 *      catches it, but we flush for clarity).
 *   5. Enquiry round-trip: POST /public/enquiry (no auth, beacon host) → 201;
 *      beacon admin GET /site/enquiries includes it; cleaned up in afterAll.
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

/** Obtain a school-scoped JWT without TOTP (school admins have no TOTP). */
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

describeLiveApi('Public API e2e', () => {
  const ts = Date.now();
  // Slug must match ^[a-z0-9-]{2,32}$. e.g. "e2et1751234567890" = 17 chars ✓
  const throwawaySlug = `e2et${ts}`;
  let throwawaySchoolId: string;
  let testEnquiryId: string | undefined;

  beforeAll(async () => {
    const db = getPlatformPrisma();

    // Create throwaway BASIC-tier LIVE school for gating and suspension tests.
    const school = await db.school.create({
      data: {
        slug: throwawaySlug,
        name: 'E2E Throwaway School',
        tier: 'BASIC',
        status: 'LIVE',
      },
    });
    throwawaySchoolId = school.id;

    // Create SchoolProfile with contact info populated — gating will null these out.
    await db.schoolProfile.create({
      data: {
        schoolId: throwawaySchoolId,
        brandColorPrimary: '#ff0000',
        brandColorSecondary: '#00ff00',
        phone: '+1 555 123 4567',
        email: 'throwaway@test.test',
        city: 'Test City',
        country: 'IN',
      },
    });

    // Create HomepageContent with aboutText populated — gating will null it out.
    await db.homepageContent.create({
      data: {
        schoolId: throwawaySchoolId,
        headline: 'Throwaway School Headline',
        aboutText: 'This text should be gated away on BASIC tier',
      },
    });

    // Create a Grade so menu is non-empty and the site loads correctly.
    await db.grade.create({
      data: {
        schoolId: throwawaySchoolId,
        name: 'Grade 1',
        order: 0,
      },
    });
  });

  afterAll(async () => {
    const db = getPlatformPrisma();

    // Delete test enquiry if not already cleaned up within the test.
    if (testEnquiryId) {
      await db.enquiry.deleteMany({ where: { id: testEnquiryId } }).catch(() => undefined);
    }

    // Delete throwaway school (cascades: profile, homepage, grades, enquiries, domains, etc.).
    if (throwawaySchoolId) {
      await db.school.delete({ where: { id: throwawaySchoolId } }).catch(() => undefined);
    }

    // Flush leftover Redis cache entries for the throwaway school.
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    try {
      await redis.del(`host:${throwawaySlug}.localhost`);
      if (throwawaySchoolId) await redis.del(`feat:${throwawaySchoolId}`);
    } catch { /* ignore */ } finally {
      await redis.quit();
    }

    await disconnectAll();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Host resolution — known schools return 200 with expected shape
  // ──────────────────────────────────────────────────────────────────────────
  describe('GET /public/site — host resolution', () => {
    it('beacon (PRO) → 200 with school.name, school.tier=PRO, non-empty menu, homepage', async () => {
      const res = await fetch(`${BASE}/public/site`, {
        headers: { 'X-Forwarded-Host': 'beacon.localhost' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        school: { name: string; tier: string };
        menu: unknown[];
        homepage: unknown;
      };
      expect(body.school.name).toBe('Beacon Public School');
      expect(body.school.tier).toBe('PRO');
      expect(Array.isArray(body.menu)).toBe(true);
      expect(body.menu.length).toBeGreaterThan(0);
      expect(body.homepage).not.toBeNull();
    });

    it('acme (STANDARD) → 200 with school.name, non-empty menu, homepage', async () => {
      const res = await fetch(`${BASE}/public/site`, {
        headers: { 'X-Forwarded-Host': 'acme.localhost' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        school: { name: string; tier: string };
        menu: unknown[];
        homepage: unknown;
      };
      expect(typeof body.school.name).toBe('string');
      expect(body.school.name.length).toBeGreaterThan(0);
      expect(body.school.tier).toBe('STANDARD');
      expect(Array.isArray(body.menu)).toBe(true);
      expect(body.menu.length).toBeGreaterThan(0);
      expect(body.homepage).not.toBeNull();
    });

    it('platform host (owner.localhost) → 404', async () => {
      const res = await fetch(`${BASE}/public/site`, {
        headers: { 'X-Forwarded-Host': 'owner.localhost' },
      });
      expect(res.status).toBe(404);
    });

    it('unknown host (nope.localhost) → 404', async () => {
      const res = await fetch(`${BASE}/public/site`, {
        headers: { 'X-Forwarded-Host': 'nope.localhost' },
      });
      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Feature gating — BASIC tier (ABOUT_CONTACT excluded)
  // ──────────────────────────────────────────────────────────────────────────
  describe('feature gating — BASIC tier school', () => {
    /**
     * Cache note: the throwaway school is freshly created in beforeAll, so no
     * feat:<id> Redis entry exists. The first request computes features from DB
     * (BASIC tier, no overrides → excludes ABOUT_CONTACT). No cache flush needed.
     *
     * Host resolution uses the subdomain path: hostname e2et<ts>.localhost →
     * slug e2et<ts> → platform.school.findUnique({ where: { slug } }). The school
     * is LIVE at this point, so kind === 'tenant'. ✓
     */
    it('BASIC school → 200, homepage.aboutText === null, profile contact fields null', async () => {
      const res = await fetch(`${BASE}/public/site`, {
        headers: { 'X-Forwarded-Host': `${throwawaySlug}.localhost` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        school: { tier: string };
        homepage: { headline: string; aboutText: string | null } | null;
        profile: {
          phone: string | null;
          email: string | null;
          city: string | null;
        } | null;
        menu: unknown[];
      };
      expect(body.school.tier).toBe('BASIC');
      // ABOUT_CONTACT is not in BASIC tier → these fields must be null.
      expect(body.homepage).not.toBeNull();
      expect(body.homepage!.aboutText).toBeNull();
      // headline is always present (not gated).
      expect(typeof body.homepage!.headline).toBe('string');
      expect(body.homepage!.headline.length).toBeGreaterThan(0);
      // Profile contact fields are gated.
      expect(body.profile).not.toBeNull();
      expect(body.profile!.phone).toBeNull();
      expect(body.profile!.email).toBeNull();
      expect(body.profile!.city).toBeNull();
      // menu has the Grade 1 we created.
      expect(body.menu.length).toBeGreaterThan(0);
    });

    it('theme fields present with defaults on a school that never set them', async () => {
      const res = await fetch(`${BASE}/public/site`, {
        headers: { 'X-Forwarded-Host': `${throwawaySlug}.localhost` },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        profile: { headingFont: string; heroStyle: string; animationLevel: string } | null;
      };
      expect(body.profile).not.toBeNull();
      expect(body.profile!.headingFont).toBe('INTER');
      expect(body.profile!.heroStyle).toBe('ILLUSTRATION');
      expect(body.profile!.animationLevel).toBe('FULL');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Suspended school → 404
  // ──────────────────────────────────────────────────────────────────────────
  describe('suspended school → 404', () => {
    /**
     * Cache note: the gating test above may have cached host:<hostname> as
     * { kind: 'tenant' }. After suspension we flush it so the lookup re-hits DB.
     * Even without flushing, PublicSiteService.getSite() performs a secondary
     * DB status check (`if (school.status === 'SUSPENDED') throw 404`) so the
     * 404 fires either way. We flush for determinism.
     */
    it('set throwaway school SUSPENDED, flush host cache → GET /public/site returns 404', async () => {
      const db = getPlatformPrisma();
      await db.school.update({
        where: { id: throwawaySchoolId },
        data: { status: 'SUSPENDED' },
      });

      // Flush Redis host cache so the lookup path also exercises the status check.
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
      try {
        await redis.del(`host:${throwawaySlug}.localhost`);
      } catch { /* ignore */ } finally {
        await redis.quit();
      }

      const res = await fetch(`${BASE}/public/site`, {
        headers: { 'X-Forwarded-Host': `${throwawaySlug}.localhost` },
      });
      expect(res.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Enquiry round-trip
  // ──────────────────────────────────────────────────────────────────────────
  describe('enquiry round-trip', () => {
    it('POST /public/enquiry (beacon, no auth) → 201 with an id', async () => {
      const res = await fetch(`${BASE}/public/enquiry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'beacon.localhost',
        },
        body: JSON.stringify({
          parentName: `E2E Parent ${ts}`,
          phone: '+1 555 000 0001',
          message: 'Enquiry round-trip test.',
        }),
      });
      expect(res.status).toBe(201);
      const enq = await res.json() as { id: string };
      expect(typeof enq.id).toBe('string');
      expect(enq.id.length).toBeGreaterThan(0);
      testEnquiryId = enq.id;
    });

    it('beacon admin GET /site/enquiries → includes the submitted enquiry', async () => {
      const beaconToken = await schoolToken('beacon');
      const res = await fetch(`${BASE}/site/enquiries`, {
        headers: {
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${beaconToken}`,
        },
      });
      expect(res.status).toBe(200);
      const list = await res.json() as Array<{ id: string }>;
      expect(Array.isArray(list)).toBe(true);
      expect(list.some((e) => e.id === testEnquiryId)).toBe(true);
    });

    it('cleanup: delete the test enquiry via platform Prisma', async () => {
      const db = getPlatformPrisma();
      await db.enquiry.deleteMany({ where: { id: testEnquiryId } });
      testEnquiryId = undefined; // Mark as already cleaned up in afterAll.
    });
  });
});
