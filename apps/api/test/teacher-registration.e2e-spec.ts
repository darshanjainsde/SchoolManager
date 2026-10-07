import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll, getPlatformPrisma } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * ADDING A TEACHER, asked of the REAL booted app (2026-10-07).
 *
 * The Add teacher form sends '' for every field left blank. The DTO refused
 * twelve of them — an office read that as twelve required fields — and no test
 * ever posted the form's own body, because the form's tests mock the API.
 * This file posts exactly that body, then holds the identity rules:
 *  - required: a first name, an email, a mobile (a last name is optional);
 *  - one teacher record per person at a school (email OR mobile, however typed);
 *  - one ACTIVE teaching post per person across schools, the other school unnamed;
 *  - the same mobile may still be a family login here, and a parent's number
 *    may sit on many pupils — those are not teachers and never collide.
 */
describe('adding a teacher: the form’s real body and who a teacher is', () => {
  let app: INestApplication;
  let a: Awaited<ReturnType<typeof seedMinimalSchool>>;
  let b: Awaited<ReturnType<typeof seedMinimalSchool>>;
  const tok: Record<string, string> = {};
  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e5)}`;
  /** A fresh, valid Indian mobile per test, so tests never collide on the shared DB. */
  let n = 0;
  const mobile = () => `9${String(Date.now() % 1e8).padStart(8, '0')}${n++ % 10}`;

  /** The body teacher-form.tsx's toRecordBody builds for "names, email, mobile; nothing else". */
  const formBody = (over: Record<string, unknown> = {}) => ({
    firstName: 'Rishika', lastName: '', email: `rishika.${uniq()}@school.test`, phone: mobile(), photoAssetId: null, whatsappOptIn: false,
    gender: '', dob: '', bloodGroup: '', whatsappPhone: '', employeeCode: '', designation: '', department: '', employmentType: '', joinedOn: '',
    highestQualification: '', professionalQualification: '', tetStatus: '', tetCertificateNo: '', tetValidTill: '', specialisation: '',
    previousSchool: '', addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', emergencyContactName: '',
    emergencyContactPhone: '', emergencyContactRelation: '', policeVerification: '', policeVerifiedOn: '', medicalFitnessOn: '', pocsoTrainedOn: '',
    ...over,
  });

  beforeAll(async () => {
    a = await seedMinimalSchool();
    b = await seedMinimalSchool();
    tok.admin = signSchoolToken({ sub: a.adminUserId, schoolId: a.schoolId, role: 'SCHOOL_ADMIN' });
    tok.teacher = signSchoolToken({ sub: a.teacherUserId, schoolId: a.schoolId, role: 'TEACHER' });
    tok.staff = signSchoolToken({ sub: a.staffUserId, schoolId: a.schoolId, role: 'STAFF' });
    tok.student = signSchoolToken({ sub: a.studentUserId, schoolId: a.schoolId, role: 'STUDENT' });
    tok.adminB = signSchoolToken({ sub: b.adminUserId, schoolId: b.schoolId, role: 'SCHOOL_ADMIN' });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const as = (host: string, token?: string) => ({
    post: (path: string) => { const r = request(app.getHttpServer()).post(path).set('X-Skoolos-Host', host); return token ? r.set('Authorization', `Bearer ${token}`) : r; },
    put: (path: string) => { const r = request(app.getHttpServer()).put(path).set('X-Skoolos-Host', host); return token ? r.set('Authorization', `Bearer ${token}`) : r; },
    get: (path: string) => { const r = request(app.getHttpServer()).get(path).set('X-Skoolos-Host', host); return token ? r.set('Authorization', `Bearer ${token}`) : r; },
  });
  const adminA = () => as(a.host, tok.admin);
  const adminB = () => as(b.host, tok.adminB);

  describe('the form’s own body', () => {
    it('is accepted with every optional field blank, and blanks are stored as nothing', async () => {
      const body = formBody();
      const res = await adminA().post('/manage/teachers').send(body).expect(201);
      expect(res.body).toMatchObject({ firstName: 'Rishika', lastName: '', email: body.email, designation: null, dob: null, phoneE164: `+91${body.phone}` });
    });

    it('stores the email lower-cased and trimmed', async () => {
      const res = await adminA().post('/manage/teachers').send(formBody({ email: `  Asha.${uniq()}@School.TEST ` })).expect(201);
      expect(res.body.email).toMatch(/^asha\.\d+@school\.test$/);
    });

    it.each([
      ['firstName', { firstName: '' }],
      ['email', { email: '' }],
      ['phone', { phone: '' }],
      ['phone', { phone: '12345' }],
    ])('refuses a missing or bad %s with a 400', async (_f, over) => {
      await adminA().post('/manage/teachers').send(formBody(over)).expect(400);
    });

    it('an edit can clear a date it set, and cannot blank the mobile', async () => {
      const { body: t } = await adminA().post('/manage/teachers').send(formBody({ dob: '1990-05-01', designation: 'TGT' })).expect(201);
      const cleared = await adminA().put(`/manage/teachers/${t.id}`).send(formBody({ email: t.email, phone: t.phone, dob: '', designation: '' })).expect(200);
      expect(cleared.body).toMatchObject({ dob: null, designation: null });
      await adminA().put(`/manage/teachers/${t.id}`).send({ phone: '' }).expect(400);
    });
  });

  describe('one record per person at a school', () => {
    it('refuses the same email in another case, on the email field', async () => {
      const first = formBody();
      await adminA().post('/manage/teachers').send(first).expect(201);
      const res = await adminA().post('/manage/teachers').send(formBody({ email: first.email.toUpperCase() })).expect(409);
      expect(res.body).toMatchObject({ code: 'ALREADY_TEACHER_HERE', field: 'email' });
    });

    it.each([['+91 %s'], ['0%s'], ['91-%s']])('refuses the same mobile written as %p, on the phone field', async (shape) => {
      const first = formBody();
      await adminA().post('/manage/teachers').send(first).expect(201);
      const res = await adminA().post('/manage/teachers').send(formBody({ phone: shape.replace('%s', first.phone as string) })).expect(409);
      expect(res.body).toMatchObject({ code: 'ALREADY_TEACHER_HERE', field: 'phone' });
    });

    it('an edit that keeps its own email and mobile is not its own duplicate', async () => {
      const { body: t } = await adminA().post('/manage/teachers').send(formBody()).expect(201);
      await adminA().put(`/manage/teachers/${t.id}`).send({ email: t.email, phone: t.phone, city: 'Jaipur' }).expect(200);
    });

    it('an edit cannot take another teacher’s mobile', async () => {
      const one = formBody();
      await adminA().post('/manage/teachers').send(one).expect(201);
      const { body: two } = await adminA().post('/manage/teachers').send(formBody()).expect(201);
      const res = await adminA().put(`/manage/teachers/${two.id}`).send({ phone: one.phone }).expect(409);
      expect(res.body).toMatchObject({ code: 'ALREADY_TEACHER_HERE', field: 'phone' });
    });

    it('two offices adding the same person at the same moment: exactly one wins', async () => {
      const body = formBody();
      const results = await Promise.all([1, 2, 3].map(() => adminA().post('/manage/teachers').send(body)));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    });
  });

  describe('one active teaching post across schools', () => {
    it('refuses a person active at another school, and does not name it', async () => {
      const body = formBody();
      await adminA().post('/manage/teachers').send(body).expect(201);
      const res = await adminB().post('/manage/teachers').send(formBody({ phone: body.phone })).expect(409);
      expect(res.body).toMatchObject({ code: 'ALREADY_AT_SCHOOL', field: 'phone' });
      expect(JSON.stringify(res.body)).not.toContain('Authz Test School');
    });

    it('lets a released teacher join another school', async () => {
      const body = formBody();
      const { body: t } = await adminA().post('/manage/teachers').send(body).expect(201);
      await getPlatformPrisma().teacher.update({ where: { id: t.id }, data: { isActive: false, status: 'LEFT' } });
      await adminB().post('/manage/teachers').send(formBody({ email: body.email, phone: body.phone })).expect(201);
    });

    it('a parent’s number on several pupils is not a teacher, and a teacher may share it', async () => {
      const phone = mobile();
      const db = getPlatformPrisma();
      for (const [i, adm] of ['P-1', 'P-2'].entries()) {
        await db.student.create({ data: { schoolId: a.schoolId, admissionNo: `${adm}-${uniq()}`, firstName: `Kid${i}`, lastName: 'Agarwal', guardianPhone: phone, guardianPhoneE164: `+91${phone}` } });
      }
      const check = await adminA().get(`/manage/teachers/identity-check?phone=${phone}`).expect(200);
      expect(check.body).toMatchObject({ teacherHere: null, activeElsewhere: null, phoneValid: true });
      expect(check.body.familyHere).toHaveLength(2);
      await adminA().post('/manage/teachers').send(formBody({ phone })).expect(201);
    });
  });

  describe('the live check — GET /manage/teachers/identity-check', () => {
    it('names the teacher already here and the field it matched', async () => {
      const body = formBody({ firstName: 'Meera' });
      const { body: t } = await adminA().post('/manage/teachers').send(body).expect(201);
      const res = await adminA().get(`/manage/teachers/identity-check?email=${encodeURIComponent(body.email.toUpperCase())}`).expect(200);
      expect(res.body.teacherHere).toMatchObject({ id: t.id, name: 'Meera', field: 'email', left: false });
      // …but never the record being edited.
      const self = await adminA().get(`/manage/teachers/identity-check?email=${encodeURIComponent(body.email)}&excludeId=${t.id}`).expect(200);
      expect(self.body.teacherHere).toBeNull();
    });

    it('says yes or no for another school, nothing more', async () => {
      const body = formBody();
      await adminA().post('/manage/teachers').send(body).expect(201);
      const res = await adminB().get(`/manage/teachers/identity-check?phone=${body.phone}`).expect(200);
      expect(res.body).toMatchObject({ teacherHere: null, activeElsewhere: 'phone' });
      expect(JSON.stringify(res.body)).not.toContain('Authz Test School');
    });

    it('flags a number that is not a mobile', async () => {
      const res = await adminA().get('/manage/teachers/identity-check?phone=12345').expect(200);
      expect(res.body.phoneValid).toBe(false);
    });

    it.each(['teacher', 'staff', 'student'])('refuses a %s', async (who) => {
      await as(a.host, tok[who]).get('/manage/teachers/identity-check?phone=9876543210').expect(403);
    });

    it('refuses an anonymous caller', async () => {
      await as(a.host).get('/manage/teachers/identity-check?phone=9876543210').expect(401);
    });
  });
});
