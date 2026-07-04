/**
 * CMS E2E — requires a SEPARATELY BOOTED API on localhost:3001.
 *
 * These tests call the running API over HTTP, so any Prisma usage here MUST
 * target the SAME database as that API.
 * Locally: boot the API against the dev DB and run jest with
 *   DATABASE_URL_TEST=postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public
 * In CI: boot the API against skoolos_test and omit DATABASE_URL_TEST.
 *
 * Seeded credentials used here:
 *   acme admin:   admin@acme.test   / Passw0rd!  host: acme.localhost
 *   beacon admin: admin@beacon.test / Passw0rd!  host: beacon.localhost
 */

const BASE = 'http://localhost:3001';

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
  const body = await res.json();
  return body.accessToken as string;
}

describe('CMS e2e', () => {
  let acmeToken: string;
  let originalHeadline: string | null = null;
  const createdStaffIds: string[] = [];

  beforeAll(async () => {
    acmeToken = await schoolToken('acme');

    // Capture the current headline so we can restore it in afterAll.
    const contentRes = await fetch(`${BASE}/site/content`, {
      headers: {
        'X-Forwarded-Host': 'acme.localhost',
        Authorization: `Bearer ${acmeToken}`,
      },
    });
    expect(contentRes.status).toBe(200);
    const content = await contentRes.json();
    originalHeadline = content?.homepage?.headline ?? null;
  });

  afterAll(async () => {
    // Remove any staff members created during tests.
    for (const id of createdStaffIds) {
      await fetch(`${BASE}/site/staff/${id}`, {
        method: 'DELETE',
        headers: {
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
      });
    }

    // Restore the original headline (or a known safe value if it was null).
    const restoreHeadline = originalHeadline ?? 'Welcome to Acme International';
    await fetch(`${BASE}/site/homepage`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'acme.localhost',
        Authorization: `Bearer ${acmeToken}`,
      },
      body: JSON.stringify({ headline: restoreHeadline }),
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Homepage content round-trip
  // ──────────────────────────────────────────────────────────────────────────
  describe('homepage content round-trip', () => {
    const ts = Date.now();
    const testHeadline = `Acme HQ ${ts}`;

    it('PUT /site/homepage updates the headline', async () => {
      const res = await fetch(`${BASE}/site/homepage`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
        body: JSON.stringify({ headline: testHeadline }),
      });
      expect(res.status).toBeLessThan(300);
    });

    it('GET /site/content reflects the updated headline', async () => {
      const res = await fetch(`${BASE}/site/content`, {
        headers: {
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.homepage.headline).toBe(testHeadline);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1b. Theme round-trip (Phase 8)
  // ──────────────────────────────────────────────────────────────────────────
  describe('theme round-trip', () => {
    afterAll(async () => {
      // Restore acme to defaults so other suites / demos start clean.
      await fetch(`${BASE}/site/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
        body: JSON.stringify({
          headingFont: 'INTER',
          heroStyle: 'ILLUSTRATION',
          animationLevel: 'FULL',
          themePreset: null,
        }),
      });
    });

    it('PUT /site/profile accepts theme fields', async () => {
      const res = await fetch(`${BASE}/site/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
        body: JSON.stringify({
          headingFont: 'FRAUNCES',
          heroStyle: 'PHOTO',
          animationLevel: 'SUBTLE',
          themePreset: 'ACADEMIC',
        }),
      });
      expect(res.status).toBeLessThan(300);
    });

    it('GET /site/content reflects the saved theme fields', async () => {
      const res = await fetch(`${BASE}/site/content`, {
        headers: { 'X-Forwarded-Host': 'acme.localhost', Authorization: `Bearer ${acmeToken}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.profile.headingFont).toBe('FRAUNCES');
      expect(body.profile.heroStyle).toBe('PHOTO');
      expect(body.profile.animationLevel).toBe('SUBTLE');
      expect(body.profile.themePreset).toBe('ACADEMIC');
    });

    it('rejects an invalid theme value (400)', async () => {
      const res = await fetch(`${BASE}/site/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
        body: JSON.stringify({ headingFont: 'COMIC' }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Staff round-trip
  // ──────────────────────────────────────────────────────────────────────────
  describe('staff round-trip', () => {
    let staffCountBefore = 0;
    let createdId: string;

    it('GET /site/staff returns current list', async () => {
      const res = await fetch(`${BASE}/site/staff`, {
        headers: {
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
      });
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(Array.isArray(list)).toBe(true);
      staffCountBefore = list.length;
    });

    it('POST /site/staff creates a new member', async () => {
      const res = await fetch(`${BASE}/site/staff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
        body: JSON.stringify({
          name: `E2E Test Staff ${Date.now()}`,
          role: 'Test Principal',
          order: 999,
        }),
      });
      expect(res.status).toBeLessThan(300);
      const member = await res.json();
      expect(typeof member.id).toBe('string');
      createdId = member.id;
      createdStaffIds.push(createdId); // register for afterAll cleanup
    });

    it('GET /site/staff list grows by 1 and includes the new member', async () => {
      const res = await fetch(`${BASE}/site/staff`, {
        headers: {
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
      });
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(list.length).toBe(staffCountBefore + 1);
      expect(list.some((m: { id: string }) => m.id === createdId)).toBe(true);
    });

    it('DELETE /site/staff/:id removes the created member', async () => {
      const res = await fetch(`${BASE}/site/staff/${createdId}`, {
        method: 'DELETE',
        headers: {
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
      });
      expect(res.status).toBeLessThan(300);
      // Remove from afterAll list since we deleted it here already.
      const idx = createdStaffIds.indexOf(createdId);
      if (idx !== -1) createdStaffIds.splice(idx, 1);
    });

    it('GET /site/staff list is back to original length after delete', async () => {
      const res = await fetch(`${BASE}/site/staff`, {
        headers: {
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
      });
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(list.length).toBe(staffCountBefore);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Cross-school isolation (the isolation proof)
  // ──────────────────────────────────────────────────────────────────────────
  describe('cross-school isolation', () => {
    it('acme token + beacon host is rejected (401 or 403)', async () => {
      // The acme token's schoolId does NOT match the beacon tenant resolved from
      // the host — SchoolJwtGuard must reject this.
      const res = await fetch(`${BASE}/site/content`, {
        headers: {
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${acmeToken}`,
        },
      });
      expect([401, 403]).toContain(res.status);
    });

    it('no token + acme host is rejected with 401', async () => {
      const res = await fetch(`${BASE}/site/content`, {
        headers: { 'X-Forwarded-Host': 'acme.localhost' },
      });
      expect(res.status).toBe(401);
    });

    it('beacon token can read its own content but not acme content', async () => {
      const beaconToken = await schoolToken('beacon');

      // Beacon can read its own site.
      const beaconRes = await fetch(`${BASE}/site/content`, {
        headers: {
          'X-Forwarded-Host': 'beacon.localhost',
          Authorization: `Bearer ${beaconToken}`,
        },
      });
      expect(beaconRes.status).toBe(200);

      // Beacon token replayed at acme host must be rejected.
      const acmeRes = await fetch(`${BASE}/site/content`, {
        headers: {
          'X-Forwarded-Host': 'acme.localhost',
          Authorization: `Bearer ${beaconToken}`,
        },
      });
      expect([401, 403]).toContain(acmeRes.status);
    });
  });
});
