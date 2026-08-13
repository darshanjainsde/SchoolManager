import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { closeOrgLookupRedis } from '../src/modules/tenancy';
import { signAccessToken } from '../src/modules/auth/internal/auth.module';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

interface Org { orgId: string; slug: string; branchId: string; token: string; assistantToken: string }
const host = (o: Pick<Org, 'slug'>) => `${o.slug}.library.trackyour.in`;

async function seedOrg(suffix: string): Promise<Org> {
  const prisma = getLibraryPlatformPrisma();
  const org = await prisma.libraryOrg.create({ data: { slug: `per-${suffix}`, name: 'Period E2E', status: 'LIVE' } });
  const branch = await prisma.branch.create({ data: { orgId: org.id, name: 'Main', code: 'MAIN' } });
  await prisma.circulationPolicy.create({
    data: { orgId: org.id, memberType: 'STUDENT', maxBooks: 3, issueDays: 14, renewLimit: 1, renewDays: 14,
            finePerDay: 1, graceDays: 3, maxReservations: 3, reservedShelfDays: 5 },
  });
  const passwordHash = await argon2.hash('per-e2e-Pw1!', { type: argon2.argon2id });
  const jwt = new JwtService();
  const mk = async (role: 'LIBRARIAN' | 'ASSISTANT', tag: string) => {
    const u = await prisma.libUser.create({
      data: { orgId: org.id, email: `${tag}-${suffix}@per.test`, passwordHash, role, branchIds: [], active: true },
    });
    return signAccessToken(jwt, { id: u.id, orgId: u.orgId, role: u.role, branchIds: u.branchIds });
  };
  return { orgId: org.id, slug: org.slug, branchId: branch.id,
           token: await mk('LIBRARIAN', 'lib'), assistantToken: await mk('ASSISTANT', 'as') };
}

describeLive('the library period (Phase 2c)', () => {
  let app: INestApplication;
  let org: Org;
  let memberA: { id: string };
  let memberB: { id: string };
  let accession: string;

  const api = (token?: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(p).set('X-Library-Host', host(org)).set('Authorization', `Bearer ${token ?? org.token}`),
    post: (p: string) => request(app.getHttpServer()).post(p).set('X-Library-Host', host(org)).set('Authorization', `Bearer ${token ?? org.token}`),
    patch: (p: string) => request(app.getHttpServer()).patch(p).set('X-Library-Host', host(org)).set('Authorization', `Bearer ${token ?? org.token}`),
  });

  beforeAll(async () => {
    process.env.DISABLE_THROTTLER = 'true';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    org = await seedOrg(Date.now().toString(36));
    const prisma = getLibraryPlatformPrisma();
    memberA = await prisma.member.create({
      data: { orgId: org.orgId, homeBranchId: org.branchId, code: `P-${Date.now()}A`, firstName: 'Asha', lastName: 'Rao', status: 'ACTIVE', classRef: '6-B' },
    });
    memberB = await prisma.member.create({
      data: { orgId: org.orgId, homeBranchId: org.branchId, code: `P-${Date.now()}B`, firstName: 'Bala', lastName: 'Iyer', status: 'ACTIVE', classRef: '6-B' },
    });
    const title = await prisma.title.create({ data: { orgId: org.orgId, title: 'Period Test Book' } });
    accession = `9${Date.now().toString().slice(-6)}`;
    await prisma.copy.create({ data: { orgId: org.orgId, titleId: title.id, branchId: org.branchId, accessionNumber: accession } });
  }, 90_000);

  afterAll(async () => {
    delete process.env.DISABLE_THROTTLER;
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: org?.orgId } });
    await app?.close();
    await closeOrgLookupRedis();
    await disconnectLibrary();
  });

  describe('settings', () => {
    it('are created on first read rather than needing a backfill', async () => {
      const res = await api().get('/periods/settings').expect(200);
      expect(res.body).toMatchObject({ concurrentClassCapacity: 2, recordAttendance: true });
    });

    /** A default that quietly bills a ten-year-old is the wrong default. */
    it('do not charge students fines by default', async () => {
      expect((await api().get('/periods/settings').expect(200)).body.chargeStudentFines).toBe(false);
    });

    it('an assistant may read them but not change them', async () => {
      await api(org.assistantToken).get('/periods/settings').expect(200);
      await api(org.assistantToken).patch('/periods/settings').send({ concurrentClassCapacity: 5 }).expect(403);
    });
  });

  describe('the capacity guard', () => {
    it('accepts classes up to the room capacity', async () => {
      await api().post('/periods').send({ branchId: org.branchId, weekday: 2, period: 3, classRef: '6-B' }).expect(201);
      await api().post('/periods').send({ branchId: org.branchId, weekday: 2, period: 3, classRef: '4-A' }).expect(201);
    });

    /**
     * The point of the whole feature: discovering the room is over-booked when
     * eighty children arrive is not a validation failure, it is an incident.
     */
    /**
     * WARNS rather than refuses. The librarian receives the school timetable,
     * she does not author it — refusing to record a third class does not empty
     * the room, it just means the software cannot describe Tuesday.
     */
    it('records an over-subscribed period but says so, loudly', async () => {
      const res = await api().post('/periods').send({ branchId: org.branchId, weekday: 2, period: 3, classRef: '9-C' }).expect(201);
      expect(res.body.overCapacity).toBe(true);
      expect(String(res.body.warning)).toMatch(/2 class\(es\) at once; this period now has 3/);
    });

    it('does not warn while the room is within capacity', async () => {
      const res = await api().post('/periods').send({ branchId: org.branchId, weekday: 3, period: 1, classRef: '5-A' }).expect(201);
      expect(res.body.overCapacity).toBe(false);
      expect(res.body.warning).toBeNull();
    });

    it('a different period is unaffected by a full one', async () => {
      await api().post('/periods').send({ branchId: org.branchId, weekday: 2, period: 4, classRef: '7-A' }).expect(201);
    });

    it('booking the same class into the same slot twice is a clear 409, not a crash', async () => {
      const res = await api().post('/periods').send({ branchId: org.branchId, weekday: 2, period: 4, classRef: '7-A' }).expect(409);
      expect(res.body.reason).toBe('ALREADY_SCHEDULED');
    });
  });

  describe('visits and auto-attendance', () => {
    let visitId: string;

    it('opens a visit and shows the whole class roster', async () => {
      const opened = await api(org.assistantToken).post('/periods/visits/open')
        .send({ branchId: org.branchId, classRef: '6-B' }).expect(201);
      visitId = opened.body.id;

      const live = await api().get('/periods/visits/live').expect(200);
      const visit = live.body.visits.find((v: { id: string }) => v.id === visitId);
      expect(visit.strength).toBe(2);
      expect(visit.present).toBe(0);
      expect(visit.roster.every((r: { seen: string }) => r.seen === 'no')).toBe(true);
    });

    it('reopening is idempotent — a class returning after break is one visit, not two', async () => {
      const again = await api().post('/periods/visits/open').send({ branchId: org.branchId, classRef: '6-B' }).expect(201);
      expect(again.body.id).toBe(visitId);
    });

    /** The whole attendance argument: the transaction proves presence. */
    it('issuing a book marks that child present automatically', async () => {
      await api().post('/circulation/issue')
        .set('Idempotency-Key', `att-${Date.now()}`)
        .send({ accessionNumber: accession, memberId: memberA.id })
        .expect(201);

      const live = await api().get('/periods/visits/live').expect(200);
      const visit = live.body.visits.find((v: { id: string }) => v.id === visitId);
      const asha = visit.roster.find((r: { id: string }) => r.id === memberA.id);
      expect(asha.seen).toBe('auto');
      expect(asha.holding).toBe(1);
      expect(visit.present).toBe(1);
    });

    /**
     * Returning deliberately does NOT mark presence: "Ma'am, I brought Ravi's
     * book" is daily, and marking Ravi present would put a child in the library
     * who is absent from school. A false positive on attendance is far worse
     * than a false negative.
     */
    it('returning does NOT mark the holder present', async () => {
      const prisma = getLibraryPlatformPrisma();
      const solo = await prisma.member.create({
        data: { orgId: org.orgId, homeBranchId: org.branchId, code: `P-${Date.now()}R`, firstName: 'Proxy', lastName: 'Case', status: 'ACTIVE', classRef: '6-B' },
      });
      const t = await prisma.title.create({ data: { orgId: org.orgId, title: 'Proxy Book' } });
      const acc = `8${Date.now().toString().slice(-6)}`;
      await prisma.copy.create({ data: { orgId: org.orgId, titleId: t.id, branchId: org.branchId, accessionNumber: acc } });
      await prisma.issue.create({
        data: { orgId: org.orgId, copyId: (await prisma.copy.findFirstOrThrow({ where: { accessionNumber: acc, orgId: org.orgId } })).id,
                branchId: org.branchId, memberId: solo.id, dueAt: new Date(Date.now() + 86400000) },
      });
      await prisma.copy.updateMany({ where: { accessionNumber: acc, orgId: org.orgId }, data: { status: 'ISSUED' } });

      await api().post('/circulation/return')
        .set('Idempotency-Key', `proxy-${Date.now()}`)
        .send({ accessionNumber: acc })
        .expect(201);

      const live = await api().get('/periods/visits/live').expect(200);
      const visit = live.body.visits.find((v: { id: string }) => v.id === visitId);
      expect(visit.roster.find((r: { id: string }) => r.id === solo.id).seen).toBe('no');
    });

    it('the librarian ticks only the browsers by hand', async () => {
      await api(org.assistantToken).post(`/periods/visits/${visitId}/attendance`).send({ memberId: memberB.id }).expect(201);
      const live = await api().get('/periods/visits/live').expect(200);
      const visit = live.body.visits.find((v: { id: string }) => v.id === visitId);
      expect(visit.roster.find((r: { id: string }) => r.id === memberB.id).seen).toBe('hand');
      expect(visit.present).toBe(2);
    });

    it('a hand tick can be undone — a mis-tap must be correctable', async () => {
      await api().post(`/periods/visits/${visitId}/attendance`).send({ memberId: memberB.id, present: false }).expect(201);
      const live = await api().get('/periods/visits/live').expect(200);
      const visit = live.body.visits.find((v: { id: string }) => v.id === visitId);
      expect(visit.roster.find((r: { id: string }) => r.id === memberB.id).seen).toBe('no');
    });

    /**
     * A transaction is stronger evidence than a box, so a stray hand tick must
     * never downgrade a record that a real issue/return created.
     */
    it('a hand tick does not downgrade an automatic one', async () => {
      await api().post(`/periods/visits/${visitId}/attendance`).send({ memberId: memberA.id }).expect(201);
      const live = await api().get('/periods/visits/live').expect(200);
      const visit = live.body.visits.find((v: { id: string }) => v.id === visitId);
      expect(visit.roster.find((r: { id: string }) => r.id === memberA.id).seen).toBe('auto');
    });

    it('closing the visit removes it from the live view', async () => {
      await api().post(`/periods/visits/${visitId}/close`).expect(201);
      const live = await api().get('/periods/visits/live').expect(200);
      expect(live.body.visits.find((v: { id: string }) => v.id === visitId)).toBeUndefined();
    });
  });

  describe('attendance can be switched off entirely', () => {
    it('no attendance is recorded when the setting is off', async () => {
      await api().patch('/periods/settings').send({ recordAttendance: false }).expect(200);
      await api().post('/periods/visits/open').send({ branchId: org.branchId, classRef: '4-A' }).expect(201);

      const prisma = getLibraryPlatformPrisma();
      const m = await prisma.member.create({
        data: { orgId: org.orgId, homeBranchId: org.branchId, code: `P-${Date.now()}C`, firstName: 'Chitra', lastName: 'Das', status: 'ACTIVE', classRef: '4-A' },
      });
      // A fresh copy: the shared one is still out, and issue_one_active_per_copy
      // correctly refuses a second issue of the same book.
      const t = await prisma.title.create({ data: { orgId: org.orgId, title: 'Fines-Off Book' } });
      const acc = `7${Date.now().toString().slice(-6)}`;
      await prisma.copy.create({ data: { orgId: org.orgId, titleId: t.id, branchId: org.branchId, accessionNumber: acc } });

      await api().post('/circulation/issue')
        .set('Idempotency-Key', `off-${Date.now()}`)
        .send({ accessionNumber: acc, memberId: m.id })
        .expect(201);

      const live = await api().get('/periods/visits/live').expect(200);
      const visit = live.body.visits.find((v: { classRef: string }) => v.classRef === '4-A');
      expect(visit.roster.find((r: { id: string }) => r.id === m.id).seen).toBe('no');
      await api().patch('/periods/settings').send({ recordAttendance: true }).expect(200);
    });
  });
});
