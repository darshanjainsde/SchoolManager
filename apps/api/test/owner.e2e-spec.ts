/**
 * OWNER PORTAL E2E — requires a SEPARATELY BOOTED API on localhost:3001.
 *
 * Unlike the tenant-isolation suite, these tests call the running API over HTTP,
 * so the test's own Prisma client MUST target the SAME database as that API.
 * Locally: boot the API against the dev DB and run jest with
 *   DATABASE_URL_TEST=postgresql://skoolos:skoolos@localhost:5432/skoolos?schema=public
 * In CI: boot the API against skoolos_test instead and DROP the env override —
 * never point DATABASE_URL_TEST at a real/shared database.
 */
import { getPlatformPrisma, disconnectAll } from '@skoolos/db';
import Redis from 'ioredis';
import { describeLiveApi } from './requires-live-api';

const BASE = 'http://localhost:3001';
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
  return (await res.json()).accessToken as string;
}

describeLiveApi('POST /owner/schools', () => {
  const slug = `test-${Date.now()}`;
  afterAll(async () => {
    const db = getPlatformPrisma();
    await db.school.deleteMany({ where: { slug: { in: [slug, slug + '-h'] } } });
    await disconnectAll();
  });

  it('creates a school with domain, admin, profile, grades', async () => {
    const token = await ownerToken();
    const res = await fetch(`${BASE}/owner/schools`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'owner.localhost',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'Test School',
        slug,
        tier: 'STANDARD',
        domainHostname: `${slug}.localhost`,
        adminEmail: `admin@${slug}.test`,
      }),
    });
    expect(res.status).toBeLessThan(300);
    const body = await res.json();
    expect(typeof body.id).toBe('string');
    expect(body.slug).toBe(slug);
    expect(typeof body.tempPassword).toBe('string');
    expect(body.tempPassword.length).toBeGreaterThan(0);

    const db = getPlatformPrisma();
    const s = await db.school.findUniqueOrThrow({
      where: { slug },
      include: { domains: true, users: true, profile: true, homepage: true, grades: true },
    });
    expect(s.status).toBe('SETUP');
    expect(s.tier).toBe('STANDARD');
    const createdDomain = s.domains.find((d) => d.hostname === `${slug}.localhost` && d.isPrimary);
    expect(createdDomain).toBeDefined();
    expect(createdDomain!.type).toBe('CUSTOM');
    expect(createdDomain!.status).toBe('PENDING');
    expect(s.users.some((u) => u.role === 'SCHOOL_ADMIN')).toBe(true);
    expect(s.profile).not.toBeNull();
    expect(s.homepage).not.toBeNull();
    expect(s.grades.length).toBeGreaterThan(0);
  });

  it('go-live: SETUP school 404s publicly until owner sets status LIVE', async () => {
    const token = await ownerToken();
    const db = getPlatformPrisma();
    const s = await db.school.findUniqueOrThrow({ where: { slug }, select: { id: true } });
    const publicHeaders = { 'X-Forwarded-Host': `${slug}.localhost` };

    // While SETUP the public site 404s (admin can still log in, but it's not published).
    const before = await fetch(`${BASE}/public/site`, { headers: publicHeaders });
    expect(before.status).toBe(404);

    // Owner publishes it.
    const patch = await fetch(`${BASE}/owner/schools/${s.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'owner.localhost',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: 'LIVE' }),
    });
    expect(patch.status).toBeLessThan(300);

    // Now the public site resolves.
    const after = await fetch(`${BASE}/public/site`, { headers: publicHeaders });
    expect(after.status).toBe(200);

    // Invalid status value → 400.
    const bad = await fetch(`${BASE}/owner/schools/${s.id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'owner.localhost',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: 'PUBLISHED' }),
    });
    expect(bad.status).toBe(400);
  });

  it('returns 409 on duplicate slug', async () => {
    const token = await ownerToken();
    const res = await fetch(`${BASE}/owner/schools`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'owner.localhost',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'Test School Dup',
        slug,
        tier: 'BASIC',
        domainHostname: `${slug}-alt.localhost`,
        adminEmail: `admin2@${slug}.test`,
      }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 409 on duplicate hostname', async () => {
    const token = await ownerToken();
    const res = await fetch(`${BASE}/owner/schools`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'owner.localhost',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: 'Test School Dup Hostname',
        slug: `${slug}-h`,
        tier: 'BASIC',
        domainHostname: `${slug}.localhost`,
        adminEmail: `admin3@${slug}.test`,
      }),
    });
    expect(res.status).toBe(409);
  });

  it('feature override and tier change reflect in resolved features', async () => {
    const token = await ownerToken();
    const db = getPlatformPrisma();
    const s = await db.school.findUniqueOrThrow({ where: { slug } });
    const h = {
      'Content-Type': 'application/json',
      'X-Forwarded-Host': 'owner.localhost',
      Authorization: `Bearer ${token}`,
    };

    // Warm the cache so invalidation is actually exercised
    await fetch(`${BASE}/owner/schools/${s.id}`, { headers: h });

    // Feature override: enable MANAGEMENT on a STANDARD school (not in tier defaults)
    const patchRes = await fetch(`${BASE}/owner/schools/${s.id}/features`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ featureKey: 'MANAGEMENT', enabled: true }),
    });
    expect(patchRes.status).toBeLessThan(300);
    const d1 = await patchRes.json();
    expect(d1.features).toContain('MANAGEMENT');

    // Confirm via separate GET detail that cache was invalidated correctly
    const getRes = await fetch(`${BASE}/owner/schools/${s.id}`, { headers: h });
    const d2 = await getRes.json();
    expect(d2.features).toContain('MANAGEMENT');

    // Tier change to PRO: MANAGEMENT should now be in tier defaults as well
    const tierRes = await fetch(`${BASE}/owner/schools/${s.id}/tier`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ tier: 'PRO' }),
    });
    expect(tierRes.status).toBeLessThan(300);
    const d3 = await tierRes.json();
    expect(d3.features).toContain('MANAGEMENT');
    expect(d3.tier).toBe('PRO');
  });

  it('PATCH features deletes the Redis feature cache key (invalidation)', async () => {
    const token = await ownerToken();
    const db = getPlatformPrisma();
    const s = await db.school.findUniqueOrThrow({ where: { slug } });
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    try {
      // Simulate a warmed tenant-side cache.
      await redis.set(`feat:${s.id}`, JSON.stringify(['PUBLIC_SITE']), 'EX', 300);
      const h = {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'owner.localhost',
        Authorization: `Bearer ${token}`,
      };
      const res = await fetch(`${BASE}/owner/schools/${s.id}/features`, {
        method: 'PATCH',
        headers: h,
        body: JSON.stringify({ featureKey: 'GALLERY', enabled: false }),
      });
      expect(res.status).toBeLessThan(300);
      expect(await redis.get(`feat:${s.id}`)).toBeNull(); // invalidate() must have deleted it
    } finally {
      await redis.quit();
    }
  });

  it('PATCH features returns 404 for unknown school id', async () => {
    const token = await ownerToken();
    const res = await fetch(`${BASE}/owner/schools/00000000-0000-0000-0000-000000000000/features`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'owner.localhost',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ featureKey: 'GALLERY', enabled: true }),
    });
    expect(res.status).toBe(404);
  });
});
