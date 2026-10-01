import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { AppModule } from '../src/app.module';
import { seedMinimalSchool, signPlatformToken, signSchoolToken, type MinimalSchool } from './integration/helpers';

/**
 * Who may touch a school's backups — and the gates that stand between an
 * operator and losing a school.
 *
 * Every route here can read, copy or destroy a WHOLE school, so each is
 * proven four ways: anonymous, a school admin's token on the owner host, a
 * platform token on a school host, and the operator. The engine itself is
 * proven against real Postgres in school-backup.e2e-spec.ts; this suite is
 * about the doors in front of it.
 */

const UUID = '00000000-0000-0000-0000-000000000001';

const OWNER_ROUTES: [method: 'get' | 'post', path: string][] = [
  ['get', `/owner/schools/${UUID}/backups`],
  ['post', `/owner/schools/${UUID}/backups`],
  ['post', `/owner/schools/${UUID}/delete`],
  ['get', `/owner/backups/${UUID}`],
  ['post', `/owner/backups/${UUID}/step`],
  ['get', `/owner/backups/${UUID}/download`],
  ['post', '/owner/backups/upload-url'],
  ['post', '/owner/backups/uploaded'],
  ['get', '/owner/deleted-schools'],
  ['post', '/owner/restores'],
  ['get', `/owner/restores/${UUID}`],
  ['post', `/owner/restores/${UUID}/step`],
];

describe('school backups — authorization and the delete gate', () => {
  let app: INestApplication;
  let school: MinimalSchool;
  let adminToken: string;
  const ownerHost = loadEnv().PLATFORM_OWNER_HOST;
  const asOperator = () => ({ Authorization: `Bearer ${signPlatformToken()}`, 'X-Skoolos-Host': ownerHost });
  const call = (method: 'get' | 'post', path: string) => request(app.getHttpServer())[method](path);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    school = await seedMinimalSchool();
    adminToken = signSchoolToken({ sub: school.adminUserId, schoolId: school.schoolId, role: 'SCHOOL_ADMIN' });
  });

  afterAll(async () => {
    delete process.env.SCHOOL_BACKUP_PASSWORD;
    await app.close();
    await disconnectAll();
  });

  describe.each(OWNER_ROUTES)('%s %s', (method, path) => {
    it('rejects an anonymous caller on the owner host', async () => {
      await call(method, path).set({ 'X-Skoolos-Host': ownerHost }).expect(401);
    });

    it("rejects a school ADMIN's token — a tenant credential opens nothing on the platform side", async () => {
      await call(method, path).set({ Authorization: `Bearer ${adminToken}`, 'X-Skoolos-Host': ownerHost }).expect(401);
    });

    it('rejects a platform token on a SCHOOL host', async () => {
      await call(method, path).set({ Authorization: `Bearer ${signPlatformToken()}`, 'X-Skoolos-Host': school.host }).expect(403);
    });

    it('lets the operator through the guards', async () => {
      const res = await call(method, path).set(asOperator());
      expect([401, 403]).not.toContain(res.status);
    });
  });

  describe('the engine-room endpoint', () => {
    for (const path of ['/internal/cron/school-backups', '/internal/cron/school-backups/weekly']) {
      it(`${path} refuses a caller without the cron secret`, async () => {
        const res = await call('get', path);
        expect([401, 403]).toContain(res.status);
      });
    }
    it('refuses a platform token in place of the cron secret', async () => {
      const res = await call('post', '/internal/cron/school-backups').set(asOperator());
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('gates', () => {
    it('backups are refused, with the reason, when the server has no backup password', async () => {
      delete process.env.SCHOOL_BACKUP_PASSWORD;
      const res = await call('post', `/owner/schools/${school.schoolId}/backups`).set(asOperator()).expect(503);
      expect(res.body.code).toBe('BACKUPS_NOT_CONFIGURED');
    });

    it('a LIVE school cannot be deleted, with or without a backup', async () => {
      process.env.SCHOOL_BACKUP_PASSWORD = 'e2e-backup-password-long';
      const del = await call('post', `/owner/schools/${school.schoolId}/delete`).set(asOperator()).expect(409);
      expect(del.body.code).toBe('SCHOOL_NOT_SUSPENDED');
      const direct = await request(app.getHttpServer()).delete(`/owner/schools/${school.schoolId}`).set(asOperator()).expect(409);
      expect(direct.body.code).toBe('SCHOOL_NOT_SUSPENDED');
    });

    it('a suspended school with no backup taken after the suspension is NOT deleted', async () => {
      await request(app.getHttpServer()).patch(`/owner/schools/${school.schoolId}/status`).set(asOperator()).send({ status: 'SUSPENDED' }).expect(200);
      const res = await request(app.getHttpServer()).delete(`/owner/schools/${school.schoolId}`).set(asOperator()).expect(409);
      expect(res.body.code).toBe('BACKUP_REQUIRED');
      expect(await getPlatformPrisma().school.findUnique({ where: { id: school.schoolId } })).not.toBeNull();
    });

    it('a backup taken BEFORE the suspension does not count', async () => {
      const db = getPlatformPrisma();
      const s = await db.school.findUniqueOrThrow({ where: { id: school.schoolId } });
      await db.schoolBackup.create({
        data: {
          sourceSchoolId: school.schoolId, schoolSlug: s.slug, schoolName: s.name, reason: 'MANUAL', status: 'READY',
          storageKey: `backups/schools/${school.schoolId}/old-${Date.now()}.sckools`,
          createdAt: new Date(s.statusChangedAt!.getTime() - 60_000), finishedAt: new Date(),
        },
      });
      const res = await request(app.getHttpServer()).delete(`/owner/schools/${school.schoolId}`).set(asOperator()).expect(409);
      expect(res.body.code).toBe('BACKUP_REQUIRED');
    });

    it('starts one backup per school at a time', async () => {
      const first = await call('post', `/owner/schools/${school.schoolId}/backups`).set(asOperator()).expect(201);
      expect(first.body.status).toBe('RUNNING');
      const second = await call('post', `/owner/schools/${school.schoolId}/backups`).set(asOperator()).expect(409);
      expect(second.body.code).toBe('BACKUP_RUNNING');
    });

    it('a backup whose storage is unreachable ends FAILED with the reason — never half-kept as READY', async () => {
      const [running] = await getPlatformPrisma().schoolBackup.findMany({ where: { sourceSchoolId: school.schoolId, status: 'RUNNING' } });
      const res = await call('post', `/owner/backups/${running.id}/step`).set(asOperator()).expect(201);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.error).toBeTruthy();
      // …and the school is still there: a failed final backup deletes nothing.
      expect(await getPlatformPrisma().school.findUnique({ where: { id: school.schoolId } })).not.toBeNull();
    });

    it('a restore with a bad request is refused by validation', async () => {
      await call('post', '/owner/restores').set(asOperator()).send({ backupId: 'nope', mode: 'merge', finalStatus: 'LIVE' }).expect(400);
      await call('post', '/owner/restores').set(asOperator()).send({ backupId: UUID, mode: 'restore', slug: 'Bad Slug', finalStatus: 'LIVE' }).expect(400);
    });

    it('an upload key the server did not issue is refused', async () => {
      await call('post', '/owner/backups/uploaded').set(asOperator()).send({ key: '../../schools/x/logo.png' }).expect(400);
    });
  });
});
