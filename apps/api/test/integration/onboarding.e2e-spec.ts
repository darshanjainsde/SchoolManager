/**
 * Phase 2 gates:
 *   1. Owner fills the wizard → school + AcademicYear + admin user exist,
 *      tenant is isolated, MailHog captured the invite, branding applied.
 *   2. Owner adds a custom domain → exact DNS records returned →
 *      verification job (mocked) flips status to LIVE for a resolvable
 *      domain and ERROR for an unresolvable one.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Queue, Worker } from 'bullmq';
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
import { startDomainVerificationWorker } from '../../../worker/src/jobs/domain-verification';
import pino from 'pino';

let app: INestApplication;
let world: SeededWorld;
let ownerToken: string;
let prisma: PrismaClient;
let domainWorker: Worker | undefined;

function redisConn() {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

async function platformLogin(): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/platform/auth/login')
    .set('Host', 'owner.localhost')
    .send({
      email: world.platformOwner.email,
      password: PLATFORM_PASSWORD,
      totp: currentTotp(world.platformOwner.totpSecret),
    });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`platform login failed: ${res.status} ${res.text}`);
  }
  return res.body.accessToken;
}

async function clearQueue(name: string) {
  const q = new Queue(name, { connection: redisConn() });
  await q.drain(true);
  await q.obliterate({ force: true }).catch(() => undefined);
  await q.close();
}

async function waitForDomainStatus(
  customDomainId: string,
  expected: 'LIVE' | 'ERROR',
  timeoutMs = 15000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cd = await prisma.customDomain.findUnique({ where: { id: customDomainId } });
    if (cd?.status === expected) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  const cd = await prisma.customDomain.findUnique({ where: { id: customDomainId } });
  throw new Error(`domain status never reached ${expected}; last=${cd?.status} err=${cd?.lastError}`);
}

beforeAll(async () => {
  app = await createTestApp();
  prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
});

afterAll(async () => {
  await domainWorker?.close().catch(() => undefined);
  await app?.close();
  await prisma?.$disconnect();
  await closeFixtures();
});

beforeEach(async () => {
  world = await resetAndSeed();
  await clearTenantCache();
  await clearQueue('school-provisioning');
  await clearQueue('domain-verification');
  ownerToken = await platformLogin();
});

describe('Phase 2 — owner onboarding wizard', () => {
  it('provisions a school + admin + academic year + applies branding', async () => {
    const res = await request(app.getHttpServer())
      .post('/platform/schools')
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Cedar Grove Academy',
        slug: 'cedar',
        adminEmail: 'principal@cedar.test',
        adminFirstName: 'Pat',
        adminLastName: 'Principal',
        brandColors: { primary: '#0ea5e9' },
        aboutPage: '# Welcome to Cedar Grove',
        address: { city: 'Portland', region: 'OR', country: 'US', lat: 45.5, lng: -122.6 },
        timezone: 'America/Los_Angeles',
        currency: 'USD',
        subscriptionPlan: 'PRO',
        academicYear: {
          name: '2026-2027',
          startDate: '2026-08-01',
          endDate: '2027-06-30',
        },
        initialTeachers: [
          { email: 'mr.green@cedar.test', firstName: 'George', lastName: 'Green' },
        ],
        initialStudents: [
          { email: 'kid@cedar.test', firstName: 'Kelly', lastName: 'Kid' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.schoolId).toBeTruthy();
    expect(res.body.slug).toBe('cedar');
    expect(res.body.adminEmail).toBe('principal@cedar.test');
    expect(res.body.inviteToken).toBeTruthy();
    expect(res.body.jobIds.provisioning).toBeTruthy();

    // School row, AcademicYear row, admin User row, branding all in place.
    const school = await prisma.school.findUnique({ where: { id: res.body.schoolId } });
    expect(school?.slug).toBe('cedar');
    expect(school?.subscriptionPlan).toBe('PRO');
    expect(school?.timezone).toBe('America/Los_Angeles');
    expect((school?.brandColors as { primary?: string })?.primary).toBe('#0ea5e9');
    expect(school?.aboutPage).toContain('Cedar Grove');
    expect(school?.geoLat).toBe(45.5);

    const year = await prisma.academicYear.findFirst({
      where: { schoolId: school!.id, isCurrent: true },
    });
    expect(year?.name).toBe('2026-2027');

    const admin = await prisma.user.findUnique({
      where: { schoolId_email: { schoolId: school!.id, email: 'principal@cedar.test' } },
    });
    expect(admin?.role).toBe('SCHOOL_ADMIN');
  });

  it('rejects a duplicate slug with 409', async () => {
    const post = (slug: string) =>
      request(app.getHttpServer())
        .post('/platform/schools')
        .set('Host', 'owner.localhost')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Dup Test School',
          slug,
          adminEmail: 'a@x.test',
          adminFirstName: 'A',
          adminLastName: 'B',
        });

    const a = await post('dup-slug');
    expect(a.status).toBe(201);
    const b = await post('dup-slug');
    expect(b.status).toBe(409);
  });

  it('keeps the new tenant strictly isolated from previously-seeded tenants', async () => {
    const create = await request(app.getHttpServer())
      .post('/platform/schools')
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Isolated Incorporated',
        slug: 'iso',
        adminEmail: 'iso@iso.test',
        adminFirstName: 'I',
        adminLastName: 'O',
      });
    expect(create.status).toBe(201);

    // An alpha admin token from the seed should NOT be able to read 'iso' data.
    const alphaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Host', 'alpha.localhost')
      .send({ email: world.schoolA.admin.email, password: 'TestPassw0rd!' });
    expect(alphaLogin.status).toBe(201);
    const alphaToken = alphaLogin.body.accessToken;

    // alpha admin asking iso.localhost should be 401 (cross-tenant token).
    await clearTenantCache();
    const cross = await request(app.getHttpServer())
      .get('/users')
      .set('Host', 'iso.localhost')
      .set('Authorization', `Bearer ${alphaToken}`);
    expect(cross.status).toBe(401);
  });

  it('platform admin can suspend and unsuspend a school (with audit)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/platform/schools/${world.schoolA.id}/suspend`)
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(201);

    const s = await prisma.school.findUnique({ where: { id: world.schoolA.id } });
    expect(s?.suspendedAt).toBeTruthy();
    expect(s?.subscriptionStatus).toBe('SUSPENDED');

    const audit = await prisma.auditLog.findFirst({
      where: { action: { contains: 'suspend' }, schoolId: world.schoolA.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();

    const un = await request(app.getHttpServer())
      .post(`/platform/schools/${world.schoolA.id}/unsuspend`)
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(un.status).toBe(201);
  });

  it('platform admin can impersonate (short-lived school token, audited)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/platform/schools/${world.schoolA.id}/impersonate`)
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(201);
    const { accessToken } = res.body;

    // Token works on alpha.localhost (school audience).
    await clearTenantCache();
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('SCHOOL_ADMIN');

    const audit = await prisma.auditLog.findFirst({
      where: { action: { contains: 'impersonate' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
    expect(audit?.actorType).toBe('platform');
  });
});

describe('Phase 2 — custom domains', () => {
  it('add a domain → returns exact DNS records to paste', async () => {
    const sub = await request(app.getHttpServer())
      .post(`/platform/schools/${world.schoolA.id}/domains`)
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ hostname: 'portal.alpha-school.test', type: 'SUBDOMAIN' });
    expect(sub.status).toBe(201);
    expect(sub.body.status).toBe('PENDING');
    expect(sub.body.dnsInstructions[0]).toMatchObject({
      kind: 'CNAME',
      name: 'portal',
      value: expect.stringContaining('ingress'),
    });

    const apex = await request(app.getHttpServer())
      .post(`/platform/schools/${world.schoolA.id}/domains`)
      .set('Host', 'owner.localhost')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ hostname: 'apex-alpha.test', type: 'APEX' });
    expect(apex.status).toBe(201);
    expect(apex.body.dnsInstructions[0]).toMatchObject({ kind: 'A', name: '@' });
  });

  it('mocked resolvable domain flips PENDING → LIVE; unresolvable → ERROR', async () => {
    // Drive the worker in-process so the test deterministically observes the result.
    domainWorker = startDomainVerificationWorker(pino({ level: 'silent' }));

    // Create rows directly so the API's auto-queued real-DNS job doesn't race
    // with the test's mock job.
    const okRow = await prisma.customDomain.create({
      data: {
        schoolId: world.schoolA.id,
        hostname: 'good.test-skoolos.example',
        type: 'SUBDOMAIN',
        status: 'PENDING',
        dnsTarget: 'ingress.skoolos.app',
      },
    });
    const badRow = await prisma.customDomain.create({
      data: {
        schoolId: world.schoolA.id,
        hostname: 'bad.test-skoolos.example',
        type: 'SUBDOMAIN',
        status: 'PENDING',
        dnsTarget: 'ingress.skoolos.app',
      },
    });

    const q = new Queue('domain-verification', { connection: redisConn() });
    await q.add('verify-domain', {
      customDomainId: okRow.id,
      mock: { resolvable: true, reachable: true },
    });
    await q.add('verify-domain', {
      customDomainId: badRow.id,
      mock: { resolvable: false, reachable: false },
    });
    await q.close();

    await waitForDomainStatus(okRow.id, 'LIVE');
    const live = await prisma.customDomain.findUnique({ where: { id: okRow.id } });
    expect(live?.status).toBe('LIVE');
    expect(live?.tlsStatus).toBe('ACTIVE');

    await waitForDomainStatus(badRow.id, 'ERROR');
    const errd = await prisma.customDomain.findUnique({ where: { id: badRow.id } });
    expect(errd?.status).toBe('ERROR');
    expect(errd?.lastError).toContain('verification failed');
  });

  it('school-admin (school audience) cannot manage another schools domains', async () => {
    const alphaLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Host', 'alpha.localhost')
      .send({ email: world.schoolA.admin.email, password: 'TestPassw0rd!' });
    const alphaToken = alphaLogin.body.accessToken;
    const res = await request(app.getHttpServer())
      .get(`/platform/schools/${world.schoolA.id}/domains`)
      .set('Host', 'alpha.localhost')
      .set('Authorization', `Bearer ${alphaToken}`);
    expect(res.status).toBe(403);
  });
});
