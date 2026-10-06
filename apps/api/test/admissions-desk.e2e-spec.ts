import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * The admissions desk against a real database, migrations applied by the
 * suite's global setup. The guard chain and the declaration order are also
 * pinned in unit specs; this proves they hold once Nest has mounted them.
 */
describe('the admissions desk', () => {
  let app: INestApplication;
  let host: string;
  let officerId: string;
  let adminId: string;
  let driverId: string;
  let officer: string;
  let admin: string;
  let driver: string;
  let student: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    host = seeded.host;
    adminId = seeded.adminUserId;
    driverId = seeded.driverUserId;
    const db = getPlatformPrisma();
    const user = await db.user.create({
      data: { schoolId: seeded.schoolId, email: `admissions@${seeded.host}`, role: 'STAFF', passwordHash: 'not-used' },
    });
    await db.staff.create({
      data: { schoolId: seeded.schoolId, firstName: 'Sunita', lastName: 'Kale', role: 'ADMISSIONS', userId: user.id },
    });
    officerId = user.id;
    officer = signSchoolToken({ sub: officerId, schoolId: seeded.schoolId, role: 'STAFF' });
    admin = signSchoolToken({ sub: adminId, schoolId: seeded.schoolId, role: 'SCHOOL_ADMIN' });
    driver = signSchoolToken({ sub: driverId, schoolId: seeded.schoolId, role: 'STAFF' });
    student = signSchoolToken({ sub: seeded.studentUserId, schoolId: seeded.schoolId, role: 'STUDENT' });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const send = (method: 'get' | 'post' | 'patch', path: string, token: string) =>
    request(app.getHttpServer())[method](path).set('Host', host).set('Authorization', `Bearer ${token}`);

  const walkIn = async () => {
    const res = await send('post', '/site/enquiries', officer)
      .send({ parentName: 'Meera Purohit', phone: '98290 11223', source: 'WALK_IN', gradeInterest: 'Class III' });
    expect(res.status).toBe(201);
    return res.body as { id: string; ownerUserId: string; source: string; status: string };
  };

  it('lets an admissions officer read the desk', async () => {
    expect((await send('get', '/site/enquiries', officer)).status).toBe(200);
  });

  it('refuses a driver — the job, not the login, opens this door', async () => {
    const res = await send('get', '/site/enquiries', driver);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_ADMISSIONS_DESK');
  });

  it('lists the desk members, and "owners" is not swallowed by /:id', async () => {
    const res = await send('get', '/site/enquiries/owners', officer);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: officerId, name: 'Sunita Kale', job: 'ADMISSIONS' }),
      expect.objectContaining({ userId: adminId, job: 'ADMIN' }),
    ]));
    expect((res.body as { userId: string }[]).map((m) => m.userId)).not.toContain(driverId);
  });

  it('takes a walk-in, owned by whoever typed it', async () => {
    const row = await walkIn();
    expect(row).toEqual(expect.objectContaining({ ownerUserId: officerId, source: 'WALK_IN', status: 'NEW' }));
  });

  it('a walk-in typed by a school admin is unowned, so it lands in the officers’ Unowned view', async () => {
    const res = await send('post', '/site/enquiries', admin)
      .send({ parentName: 'Meera Purohit', phone: '98290 11223', source: 'WALK_IN' });
    expect(res.status).toBe(201);
    expect(res.body.ownerUserId).toBeNull();
    const detail = await send('get', `/site/enquiries/${res.body.id}`, officer);
    expect(detail.body.ownerUserId).toBeNull();
  });

  it('refuses a student at the walk-in door', async () => {
    const res = await send('post', '/site/enquiries', student).send({ parentName: 'X', phone: '98290 11223', source: 'WALK_IN' });
    expect(res.status).toBe(403);
  });

  it('refuses a driver at the walk-in door — the job, not the login', async () => {
    const res = await send('post', '/site/enquiries', driver).send({ parentName: 'X', phone: '98290 11223', source: 'WALK_IN' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_ADMISSIONS_DESK');
  });

  it('refuses a walk-in that claims to come from the website', async () => {
    const res = await send('post', '/site/enquiries', officer).send({ parentName: 'X', phone: '98290 11223', source: 'WEBSITE' });
    expect(res.status).toBe(400);
  });

  it('moves forward, and refuses a step back with 409', async () => {
    const row = await walkIn();
    expect((await send('patch', `/site/enquiries/${row.id}`, officer).send({ status: 'VISITED' })).status).toBe(200);
    const back = await send('patch', `/site/enquiries/${row.id}`, officer).send({ status: 'CONTACTED' });
    expect(back.status).toBe(409);
    expect(back.body.code).toBe('ENQUIRY_STAGE_BACKWARDS');
  });

  it('will not hand a lead to somebody off the desk', async () => {
    const row = await walkIn();
    const res = await send('patch', `/site/enquiries/${row.id}`, officer).send({ ownerUserId: driverId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ENQUIRY_OWNER_NOT_DESK');
  });

  it('a stage move and a typed note each bump updatedAt, so the lead reads as recently touched', async () => {
    const updatedAt = async (id: string) =>
      new Date((await send('get', `/site/enquiries/${id}`, officer)).body.updatedAt).getTime();
    const tick = () => new Promise((r) => setTimeout(r, 20));
    const row = await walkIn();
    const t0 = await updatedAt(row.id);

    await tick();
    expect((await send('patch', `/site/enquiries/${row.id}`, officer).send({ status: 'INTERESTED' })).status).toBe(200);
    const t1 = await updatedAt(row.id);
    expect(t1).toBeGreaterThan(t0);

    await tick();
    expect((await send('post', `/site/enquiries/${row.id}/notes`, officer).send({ body: 'Asked about the bus' })).status).toBe(201);
    expect(await updatedAt(row.id)).toBeGreaterThan(t1);
  });

  it('a logged call moves a new lead to Contacted, stamps it, and is signed', async () => {
    const row = await walkIn();
    const logged = await send('post', `/site/enquiries/${row.id}/notes`, officer).send({ kind: 'CALL', outcome: 'CONTACTED' });
    expect(logged.status).toBe(201);
    const detail = await send('get', `/site/enquiries/${row.id}`, officer);
    expect(detail.body.status).toBe('CONTACTED');
    expect(detail.body.lastContactedAt).toBeTruthy();
    expect(detail.body.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'CALL', body: 'Called', authorName: 'Sunita Kale' }),
    ]));
  });

  it('a lost call needs a reason, and with one records it and clears the callback', async () => {
    const row = await walkIn();
    const bare = await send('post', `/site/enquiries/${row.id}/notes`, officer).send({ kind: 'CALL', outcome: 'LOST' });
    expect(bare.status).toBe(400);
    expect(bare.body.code).toBe('ENQUIRY_LOST_REASON_REQUIRED');
    expect((await send('get', `/site/enquiries/${row.id}`, officer)).body.status).toBe('NEW');

    const ok = await send('post', `/site/enquiries/${row.id}/notes`, officer)
      .send({ kind: 'CALL', outcome: 'LOST', lostReason: 'Fees too high' });
    expect(ok.status).toBe(201);
    const detail = await send('get', `/site/enquiries/${row.id}`, officer);
    expect(detail.body).toEqual(expect.objectContaining({ status: 'LOST', lostReason: 'Fees too high', followUpAt: null }));
  });

  it('a typed note still works, and a blank one is refused', async () => {
    const row = await walkIn();
    expect((await send('post', `/site/enquiries/${row.id}/notes`, officer).send({ body: 'Asked about the bus' })).status).toBe(201);
    expect((await send('post', `/site/enquiries/${row.id}/notes`, officer).send({ body: '  ' })).status).toBe(400);
  });
});
