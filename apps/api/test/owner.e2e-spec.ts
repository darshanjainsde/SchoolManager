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
    await db.school.deleteMany({ where: { slug } });
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
    const db = getPlatformPrisma();
    const s = await db.school.findUniqueOrThrow({
      where: { slug },
      include: { domains: true, users: true, profile: true, homepage: true, grades: true },
    });
    expect(s.tier).toBe('STANDARD');
    expect(s.domains.some((d) => d.hostname === `${slug}.localhost` && d.isPrimary)).toBe(true);
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
});
