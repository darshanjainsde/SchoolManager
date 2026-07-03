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

describe('POST /owner/schools', () => {
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
});
