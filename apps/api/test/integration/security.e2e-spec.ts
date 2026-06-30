/**
 * Phase 1 security gates. Every assertion in this file is a hard requirement
 * for the phase test gate:
 *
 *   1. Tenant isolation     — school A can never read school B
 *   2. RLS proof            — the tenant DB role refuses cross-tenant reads
 *                             even when the app layer is bypassed
 *   3. IDOR / object-level  — students can't read other students; teachers
 *                             can't read teachers they don't own
 *   4. Role isolation       — student can't reach staff-only paths
 *   5. Platform boundary    — school user cannot reach /platform under any
 *                             circumstance, and a platform-host request from
 *                             a school user is rejected
 *   6. Audience separation  — a school JWT is unforgeable as a platform JWT
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { createTestApp } from './app-helper';
import {
  clearTenantCache,
  closeFixtures,
  currentTotp,
  resetAndSeed,
  SeededWorld,
  TEST_PASSWORD,
} from './fixtures';

let app: INestApplication;
let world: SeededWorld;

async function loginFull(host: string, email: string, password = TEST_PASSWORD) {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .set('Host', host)
    .send({ email, password });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`login failed for ${email} on ${host}: ${res.status} ${res.text}`);
  }
  return res.body as { accessToken: string; refreshToken: string };
}

async function login(host: string, email: string, password = TEST_PASSWORD): Promise<string> {
  return (await loginFull(host, email, password)).accessToken;
}

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app?.close();
  await closeFixtures();
});

beforeEach(async () => {
  world = await resetAndSeed();
  await clearTenantCache();
});

describe('Phase 1 security gates', () => {
  // ── Layer A: tenant isolation ────────────────────────────────────────────
  describe('tenant isolation', () => {
    it('user from school A cannot read school B via REST (cross-host token replay rejected)', async () => {
      const tokenA = await login('alpha.localhost', world.schoolA.admin.email);
      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Host', 'bravo.localhost')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(401);
    });

    it('admin of school A sees only school A users', async () => {
      const tokenA = await login('alpha.localhost', world.schoolA.admin.email);
      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${tokenA}`);
      expect(res.status).toBe(200);
      const emails: string[] = res.body.map((u: { email: string }) => u.email);
      expect(emails).toEqual(expect.arrayContaining([world.schoolA.admin.email]));
      // No bravo emails ever leak.
      for (const e of emails) expect(e.endsWith('@alpha.test')).toBe(true);
    });

    it('login on the wrong subdomain fails (credentials valid only in their own tenant)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Host', 'bravo.localhost')
        .send({ email: world.schoolA.admin.email, password: TEST_PASSWORD });
      expect(res.status).toBe(401);
    });

    it('login on an unknown host fails (no tenant resolved)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Host', 'ghost.localhost')
        .send({ email: world.schoolA.admin.email, password: TEST_PASSWORD });
      expect(res.status).toBe(500);
      // The controller throws "No tenant context" — manifests as 500 by design;
      // an unknown host should never authenticate someone.
    });
  });

  // ── Postgres RLS — DB-level proof ────────────────────────────────────────
  describe('RLS at the database', () => {
    it('skoolos_app role with NO tenant set returns zero rows for any tenant table', async () => {
      const client = new Client({
        connectionString: process.env.DATABASE_URL_APP,
      });
      await client.connect();
      try {
        const r = await client.query('SELECT count(*)::int AS n FROM "User"');
        expect(r.rows[0].n).toBe(0); // RLS denies — no tenant set
      } finally {
        await client.end();
      }
    });

    it('skoolos_app role with tenant=A sees only A; tenant=B sees only B', async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL_APP });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL app.current_tenant = '${world.schoolA.id}'`);
        const ra = await client.query(
          'SELECT count(*)::int AS n FROM "User" WHERE "schoolId" = $1',
          [world.schoolB.id],
        );
        expect(ra.rows[0].n).toBe(0); // can't see B's rows
        const ra2 = await client.query('SELECT count(*)::int AS n FROM "User"');
        expect(ra2.rows[0].n).toBeGreaterThanOrEqual(6); // sees all A users
        await client.query('COMMIT');

        await client.query('BEGIN');
        await client.query(`SET LOCAL app.current_tenant = '${world.schoolB.id}'`);
        const rb = await client.query('SELECT count(*)::int AS n FROM "User"');
        expect(rb.rows[0].n).toBeGreaterThanOrEqual(3); // B has 3 seeded users
        const rbCross = await client.query(
          'SELECT count(*)::int AS n FROM "User" WHERE "schoolId" = $1',
          [world.schoolA.id],
        );
        expect(rbCross.rows[0].n).toBe(0);
        await client.query('COMMIT');
      } finally {
        await client.end();
      }
    });

    it('skoolos_platform role BYPASSES RLS (sees all tenants)', async () => {
      const client = new Client({ connectionString: process.env.DATABASE_URL_PLATFORM });
      await client.connect();
      try {
        const r = await client.query('SELECT count(*)::int AS n FROM "User"');
        expect(r.rows[0].n).toBeGreaterThanOrEqual(9); // 6 alpha + 3 bravo
      } finally {
        await client.end();
      }
    });
  });

  // ── Layer B: IDOR + object-level ─────────────────────────────────────────
  describe('IDOR / object-level', () => {
    it('student CAN read their own /students/:id', async () => {
      const t = await login('alpha.localhost', world.schoolA.student.email);
      const res = await request(app.getHttpServer())
        .get(`/students/${world.schoolA.student.id}`)
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(world.schoolA.student.id);
    });

    it('student CANNOT read another in-tenant student (returns 404, not the row)', async () => {
      const t = await login('alpha.localhost', world.schoolA.student.email);
      const res = await request(app.getHttpServer())
        .get(`/students/${world.schoolA.student2.id}`)
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(404);
      expect(res.body.email).toBeUndefined();
    });

    it('student in school A guessing a school B student ID gets 404 (no enumeration)', async () => {
      const t = await login('alpha.localhost', world.schoolA.student.email);
      const res = await request(app.getHttpServer())
        .get(`/students/${world.schoolB.student.id}`)
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(404);
    });

    it('teacher CANNOT read another teacher (own profile only — assignment-based logic ships Phase 3)', async () => {
      // Seed a second teacher in alpha to make the test concrete.
      const t = await login('alpha.localhost', world.schoolA.teacher.email);
      const res = await request(app.getHttpServer())
        .get(`/teachers/${world.schoolB.teacher.id}`)
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(404);
    });

    it('admin reads any in-tenant student successfully', async () => {
      const t = await login('alpha.localhost', world.schoolA.admin.email);
      const res = await request(app.getHttpServer())
        .get(`/students/${world.schoolA.student2.id}`)
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(200);
    });
  });

  // ── Role isolation ────────────────────────────────────────────────────────
  describe('role isolation', () => {
    it('student is forbidden from listing students', async () => {
      const t = await login('alpha.localhost', world.schoolA.student.email);
      const res = await request(app.getHttpServer())
        .get('/students')
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(403);
    });

    it('parent is forbidden from listing /users', async () => {
      const t = await login('alpha.localhost', world.schoolA.parent.email);
      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(403);
    });

    it('teacher CAN list students (in their school)', async () => {
      const t = await login('alpha.localhost', world.schoolA.teacher.email);
      const res = await request(app.getHttpServer())
        .get('/students')
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(200);
    });
  });

  // ── Platform boundary ─────────────────────────────────────────────────────
  describe('platform boundary', () => {
    it('school user cannot reach /platform/schools on their own subdomain', async () => {
      const t = await login('alpha.localhost', world.schoolA.admin.email);
      const res = await request(app.getHttpServer())
        .get('/platform/schools')
        .set('Host', 'alpha.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(403);
    });

    it('school user cannot reach /platform/schools even if they spoof owner.localhost', async () => {
      const t = await login('alpha.localhost', world.schoolA.admin.email);
      // Token was issued for the school audience; even on the platform host
      // the PlatformJwtGuard rejects non-platform-audience tokens.
      const res = await request(app.getHttpServer())
        .get('/platform/schools')
        .set('Host', 'owner.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(401);
    });

    it('platform owner must provide TOTP — wrong code rejects', async () => {
      const res = await request(app.getHttpServer())
        .post('/platform/auth/login')
        .set('Host', 'owner.localhost')
        .send({
          email: world.platformOwner.email,
          password: 'PlatformPassw0rd!',
          totp: '000000',
        });
      expect(res.status).toBe(401);
    });

    it('platform owner with correct TOTP gets a platform token that crosses tenants', async () => {
      const res = await request(app.getHttpServer())
        .post('/platform/auth/login')
        .set('Host', 'owner.localhost')
        .send({
          email: world.platformOwner.email,
          password: 'PlatformPassw0rd!',
          totp: currentTotp(world.platformOwner.totpSecret),
        });
      expect([200, 201]).toContain(res.status);
      const token = res.body.accessToken as string;
      expect(token).toBeTruthy();
      const list = await request(app.getHttpServer())
        .get('/platform/schools')
        .set('Host', 'owner.localhost')
        .set('Authorization', `Bearer ${token}`);
      expect(list.status).toBe(200);
      const slugs: string[] = list.body.map((s: { slug: string }) => s.slug);
      expect(slugs).toEqual(expect.arrayContaining(['alpha', 'bravo']));
    });

    it('platform login attempt on a tenant subdomain is rejected (host guard)', async () => {
      const res = await request(app.getHttpServer())
        .post('/platform/auth/login')
        .set('Host', 'alpha.localhost')
        .send({
          email: world.platformOwner.email,
          password: 'PlatformPassw0rd!',
          totp: currentTotp(world.platformOwner.totpSecret),
        });
      expect(res.status).toBe(403);
    });
  });

  // ── Audience separation ──────────────────────────────────────────────────
  describe('JWT audience separation', () => {
    it('a school access token is not accepted by a platform endpoint', async () => {
      const t = await login('alpha.localhost', world.schoolA.admin.email);
      const res = await request(app.getHttpServer())
        .get('/platform/schools')
        .set('Host', 'owner.localhost')
        .set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(401);
    });
  });

  // ── Lockout (rate limiter is also active but lockout is per-account) ─────
  describe('failed-login lockout', () => {
    it('locks the account after 5 wrong passwords', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/auth/login')
          .set('Host', 'alpha.localhost')
          .send({ email: world.schoolA.admin.email, password: 'nope' });
      }
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Host', 'alpha.localhost')
        .send({ email: world.schoolA.admin.email, password: TEST_PASSWORD });
      // Locked → 403; otherwise the correct password would have succeeded (200/201).
      expect(res.status).toBe(403);
    });
  });

  // ── Refresh rotation ─────────────────────────────────────────────────────
  describe('refresh rotation + reuse detection', () => {
    it('using a refresh token twice revokes the whole family', async () => {
      const { refreshToken: first } = await loginFull(
        'alpha.localhost',
        world.schoolA.admin.email,
      );

      // First refresh succeeds → new tokens issued.
      const r1 = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Host', 'alpha.localhost')
        .send({ refreshToken: first });
      expect([200, 201]).toContain(r1.status);
      expect(r1.body.accessToken).toBeTruthy();

      // Replaying the SAME refresh token must fail (rotation).
      const r2 = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Host', 'alpha.localhost')
        .send({ refreshToken: first });
      expect(r2.status).toBe(401);

      // And the newly-issued one should also be revoked due to reuse detection.
      const r3 = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Host', 'alpha.localhost')
        .send({ refreshToken: r1.body.refreshToken });
      expect(r3.status).toBe(401);
    });
  });
});
