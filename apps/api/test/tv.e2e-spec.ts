import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * Sckools TV: the display key is the whole gate on the public side, and the
 * switch is SCHOOL_ADMIN-only on the office side. Every public refusal is the
 * same 404 — whether a school runs a TV is not a passer-by's business.
 */
describe('sckools tv', () => {
  let app: INestApplication;
  let host: string;
  let schoolId: string;
  let adminToken: string;
  let studentToken: string;
  let teacherToken: string;
  let staffToken: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    host = seeded.host;
    schoolId = seeded.schoolId;
    adminToken = signSchoolToken({ sub: seeded.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });
    studentToken = signSchoolToken({ sub: seeded.studentUserId, schoolId, role: 'STUDENT' });
    teacherToken = signSchoolToken({ sub: seeded.teacherUserId, schoolId, role: 'TEACHER' });
    staffToken = signSchoolToken({ sub: seeded.staffUserId, schoolId, role: 'STAFF' });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const asHost = { 'X-Skoolos-Host': '' } as Record<string, string>;
  beforeAll(() => { asHost['X-Skoolos-Host'] = host; });

  it('the screen 404s while the TV is off, keyed or not', async () => {
    await request(app.getHttpServer()).get('/public/tv').set(asHost).expect(404);
    await request(app.getHttpServer()).get('/public/tv?key=guess').set(asHost).expect(404);
  });

  it('only the SCHOOL_ADMIN can reach the switch', async () => {
    await request(app.getHttpServer()).get('/manage/tv').set(asHost).expect(401);
    for (const token of [studentToken, teacherToken, staffToken]) {
      await request(app.getHttpServer())
        .get('/manage/tv')
        .set({ ...asHost, Authorization: `Bearer ${token}` })
        .expect(403);
    }
    const res = await request(app.getHttpServer())
      .get('/manage/tv')
      .set({ ...asHost, Authorization: `Bearer ${adminToken}` })
      .expect(200);
    expect(res.body).toEqual({ enabled: false, url: null });
  });

  it('rotate mints the link, the right key lights the screen, the wrong one stays dark', async () => {
    const rotated = await request(app.getHttpServer())
      .get('/manage/tv/rotate')
      .set({ ...asHost, Authorization: `Bearer ${adminToken}` })
      .expect(200);
    expect(rotated.body.enabled).toBe(true);
    const key = new URL(rotated.body.url).searchParams.get('key')!;

    // seedMinimalSchool leaves the school in SETUP; the TV, like the public
    // site, serves only LIVE schools.
    await getPlatformPrisma().school.update({ where: { id: schoolId }, data: { status: 'LIVE' } });

    const screen = await request(app.getHttpServer())
      .get(`/public/tv?key=${key}`)
      .set(asHost)
      .expect(200);
    expect(screen.body.school.name).toBeTruthy();
    expect(Array.isArray(screen.body.announcements)).toBe(true);

    await request(app.getHttpServer()).get('/public/tv?key=not-the-key').set(asHost).expect(404);
  });

  it('disable turns every existing link dead', async () => {
    const rotated = await request(app.getHttpServer())
      .get('/manage/tv/rotate')
      .set({ ...asHost, Authorization: `Bearer ${adminToken}` })
      .expect(200);
    const key = new URL(rotated.body.url).searchParams.get('key')!;

    await request(app.getHttpServer())
      .get('/manage/tv/disable')
      .set({ ...asHost, Authorization: `Bearer ${adminToken}` })
      .expect(200);

    await request(app.getHttpServer()).get(`/public/tv?key=${key}`).set(asHost).expect(404);
  });
});
