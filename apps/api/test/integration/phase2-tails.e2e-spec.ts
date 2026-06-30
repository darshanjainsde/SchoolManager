/**
 * Phase 2 finish-line gates:
 *   • slug-availability returns the right available + suggestion shape
 *   • preview-dns returns CNAME for SUBDOMAIN, A for APEX
 *   • invite/resend is idempotent within 24h
 *   • accept-invite consumes the placeholder hash exactly once
 *
 * Reuses the same fixtures + helpers as security.e2e-spec.ts.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Queue } from 'bullmq';
import { PrismaClient } from '@skoolos/db';
import { createTestApp } from './app-helper';
import {
  clearTenantCache,
  closeFixtures,
  currentTotp,
  PLATFORM_PASSWORD,
  resetAndSeed,
  SeededWorld,
} from './fixtures';

let app: INestApplication;
let world: SeededWorld;
let ownerToken: string;
let prisma: PrismaClient;

function redisConn() {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined, maxRetriesPerRequest: null as null };
}
async function clearQueue(name: string) {
  const q = new Queue(name, { connection: redisConn() });
  await q.drain(true);
  await q.obliterate({ force: true }).catch(() => undefined);
  await q.close();
}
async function platformLogin(): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/platform/auth/login')
    .set('Host', 'owner.localhost')
    .send({ email: world.platformOwner.email, password: PLATFORM_PASSWORD, totp: currentTotp(world.platformOwner.totpSecret) });
  return res.body.accessToken;
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
});
afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  await closeFixtures();
});
beforeEach(async () => {
  world = await resetAndSeed();
  await clearTenantCache();
  await clearQueue('school-provisioning');
  ownerToken = await platformLogin();
});

describe('Phase 2 tails — slug availability', () => {
  it('returns available=true for a free slug', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/schools/slug-availability?slug=new-school')
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
  });

  it('returns a suggestion for a taken slug', async () => {
    const res = await request(app.getHttpServer())
      .get(`/platform/schools/slug-availability?slug=${world.schoolA.slug}`)
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(false);
    expect(res.body.suggestion).toBe(`${world.schoolA.slug}-2`);
  });

  it('400s for invalid slug shape', async () => {
    const res = await request(app.getHttpServer())
      .get('/platform/schools/slug-availability?slug=BAD_SLUG!')
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });
});

describe('Phase 2 tails — preview DNS', () => {
  it('SUBDOMAIN → CNAME record', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform/schools/preview-dns')
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ hostname: 'portal.acme.test', type: 'SUBDOMAIN' });
    expect(res.status).toBe(200);
    expect(res.body.records[0].kind).toBe('CNAME');
    expect(res.body.records[0].name).toBe('portal');
  });

  it('APEX → A record', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform/schools/preview-dns')
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ hostname: 'acme.test', type: 'APEX' });
    expect(res.status).toBe(200);
    expect(res.body.records[0].kind).toBe('A');
    expect(res.body.records[0].name).toBe('@');
  });

  it('school-audience token cannot reach preview-dns', async () => {
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Host', 'alpha.localhost')
      .send({ email: world.schoolA.admin.email, password: 'TestPassw0rd!' });
    const res = await request(app.getHttpServer())
      .post('/platform/schools/preview-dns')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .send({ hostname: 'x.test', type: 'APEX' });
    expect(res.status).toBe(403);
  });
});

describe('Phase 2 tails — invite resend', () => {
  it('resends once, then throttles', async () => {
    const a = await request(app.getHttpServer())
      .post(`/platform/schools/${world.schoolA.id}/invite/resend`)
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(a.status).toBe(201);
    expect(a.body.resent).toBe(true);

    const b = await request(app.getHttpServer())
      .post(`/platform/schools/${world.schoolA.id}/invite/resend`)
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(b.status).toBe(201);
    expect(b.body.resent).toBe(false);
    expect(b.body.throttled).toBe(true);
  });
});

describe('Phase 2 tails — accept invite', () => {
  it('end-to-end: provision → accept-invite consumes token → login works', async () => {
    const provisionRes = await request(app.getHttpServer())
      .post('/platform/schools')
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Invite Test School',
        slug: 'inv',
        adminEmail: 'invite-admin@inv.test',
        adminFirstName: 'I',
        adminLastName: 'A',
      });
    expect(provisionRes.status).toBe(201);
    const { schoolId, inviteToken, adminUserId } = provisionRes.body;
    await clearTenantCache();

    // Use the school's slug host so the tenant middleware picks it up.
    const accept = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .set('Host', 'inv.localhost')
      .send({ userId: adminUserId, inviteToken, password: 'NewPassw0rd!' });
    expect(accept.status).toBe(200);
    expect(accept.body.accessToken).toBeTruthy();

    // Second use of the same token must fail (placeholder hash replaced).
    const replay = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .set('Host', 'inv.localhost')
      .send({ userId: adminUserId, inviteToken, password: 'AnotherPassw0rd!' });
    expect(replay.status).toBe(401);

    // The fresh password works for normal login.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Host', 'inv.localhost')
      .send({ email: 'invite-admin@inv.test', password: 'NewPassw0rd!' });
    expect(login.status).toBe(201);

    // Sanity: the school exists.
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    expect(school?.slug).toBe('inv');
  });

  it('rejects wrong user id', async () => {
    const provisionRes = await request(app.getHttpServer())
      .post('/platform/schools')
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Wrong School', slug: 'wrong-uid', adminEmail: 'w@w.test', adminFirstName: 'W', adminLastName: 'W' });
    expect(provisionRes.status).toBe(201);
    await clearTenantCache();

    const accept = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .set('Host', 'wrong-uid.localhost')
      .send({
        userId: '00000000-0000-0000-0000-000000000000',
        inviteToken: provisionRes.body.inviteToken,
        password: 'OkPassw0rd!',
      });
    expect(accept.status).toBe(404);
  });

  it('rejects weak password', async () => {
    const provisionRes = await request(app.getHttpServer())
      .post('/platform/schools')
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Weak', slug: 'weak', adminEmail: 'weak@w.test', adminFirstName: 'W', adminLastName: 'K' });
    await clearTenantCache();
    const accept = await request(app.getHttpServer())
      .post('/auth/accept-invite')
      .set('Host', 'weak.localhost')
      .send({ userId: provisionRes.body.adminUserId, inviteToken: provisionRes.body.inviteToken, password: 'short' });
    expect(accept.status).toBe(400);
  });
});
