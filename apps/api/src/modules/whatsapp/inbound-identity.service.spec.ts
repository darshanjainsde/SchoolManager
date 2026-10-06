const db = {
  user: { count: jest.fn() },
  staff: { findFirst: jest.fn() },
  substitution: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn() },
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));

import { InboundIdentityService } from './inbound-identity.service';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PHONE = '+919876543210';
const profile = (userId: string, kind: 'ADMIN' | 'TEACHER' | 'STAFF' | 'FAMILY', role: string) => ({ userId, schoolId: A, schoolName: 'Raffles', host: 'raffles.sckools.com', role, kind, label: userId, sub: kind });

describe('InboundIdentityService.actorFor', () => {
  const profiles = { resolve: jest.fn() };
  const svc = () => new InboundIdentityService(profiles as never);
  beforeEach(() => {
    jest.clearAllMocks();
    db.user.count.mockResolvedValue(0);
    db.staff.findFirst.mockResolvedValue(null);
  });

  it('asks about this school only, with the number normalised — a "+1 (555) …" tap matches the stored E.164', async () => {
    profiles.resolve.mockResolvedValue([]);
    await svc().actorFor('+1 (555) 159-7744', A, { kind: 'LEAVE_DESK' });
    expect(profiles.resolve).toHaveBeenCalledWith('+15551597744', { schoolId: A });
  });

  it('an admin is the leave desk', async () => {
    profiles.resolve.mockResolvedValue([profile('u-head', 'ADMIN', 'SCHOOL_ADMIN')]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: true, profile: expect.objectContaining({ userId: 'u-head' }) });
  });

  it('the accounts officer is the leave desk; a driver on the same school is not', async () => {
    profiles.resolve.mockResolvedValue([profile('u-acc', 'STAFF', 'STAFF')]);
    db.staff.findFirst.mockResolvedValueOnce({ id: 's1' });
    expect((await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).ok).toBe(true);
    expect(db.staff.findFirst.mock.calls[0][0].where).toMatchObject({ schoolId: A, userId: 'u-acc', role: 'ACCOUNTS' });
    profiles.resolve.mockResolvedValue([profile('u-driver', 'STAFF', 'STAFF')]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
  });

  it('a teacher at A (who is a parent at B) tapping Approve on A\'s leave is NOT_ALLOWED', async () => {
    profiles.resolve.mockResolvedValue([profile('u-t', 'TEACHER', 'TEACHER')]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
  });

  it('two admins verified on one phone: AMBIGUOUS — nobody acts for both', async () => {
    profiles.resolve.mockResolvedValue([profile('u-1', 'ADMIN', 'SCHOOL_ADMIN'), profile('u-2', 'ADMIN', 'SCHOOL_ADMIN')]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'AMBIGUOUS' });
  });

  it('an unknown number is NO_PROFILE; a number whose only login was switched off is INACTIVE', async () => {
    profiles.resolve.mockResolvedValue([]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'NO_PROFILE' });
    db.user.count.mockResolvedValue(1);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'INACTIVE' });
    expect(db.user.count).toHaveBeenCalledWith({ where: { schoolId: A, phone: PHONE, isActive: false } });
  });

  it('SUBSTITUTE: only the teacher the cover is assigned to — even when an admin shares the phone', async () => {
    profiles.resolve.mockResolvedValue([profile('u-head', 'ADMIN', 'SCHOOL_ADMIN'), profile('u-ramesh', 'TEACHER', 'TEACHER')]);
    db.substitution.findFirst.mockResolvedValue({ substituteTeacherId: 't-ramesh' });
    db.teacher.findFirst.mockResolvedValue({ userId: 'u-ramesh' });
    expect(await svc().actorFor(PHONE, A, { kind: 'SUBSTITUTE', substitutionId: 'sub-1' })).toEqual({ ok: true, profile: expect.objectContaining({ userId: 'u-ramesh' }) });
    expect(db.substitution.findFirst).toHaveBeenCalledWith({ where: { id: 'sub-1', schoolId: A }, select: { substituteTeacherId: true } });
  });

  it('SUBSTITUTE on a gap nobody covers, or covered by someone else, is NOT_ALLOWED', async () => {
    profiles.resolve.mockResolvedValue([profile('u-kavya', 'TEACHER', 'TEACHER')]);
    db.substitution.findFirst.mockResolvedValue({ substituteTeacherId: null });
    expect(await svc().actorFor(PHONE, A, { kind: 'SUBSTITUTE', substitutionId: 'sub-1' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
    db.substitution.findFirst.mockResolvedValue({ substituteTeacherId: 't-ramesh' });
    db.teacher.findFirst.mockResolvedValue({ userId: 'u-ramesh' });
    expect(await svc().actorFor(PHONE, A, { kind: 'SUBSTITUTE', substitutionId: 'sub-1' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
  });

  it('a "number" that is not a phone at all never reaches the profile lookup', async () => {
    expect(await svc().actorFor('hello', A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'NO_PROFILE' });
    expect(profiles.resolve).not.toHaveBeenCalled();
  });

  // ── Edge cases the controller asked for, one test each ──────────────────

  it('a husband (admin) and a wife (accounts officer) of the same school on one phone: AMBIGUOUS for the leave desk', async () => {
    profiles.resolve.mockResolvedValue([profile('u-husband', 'ADMIN', 'SCHOOL_ADMIN'), profile('u-wife', 'STAFF', 'STAFF')]);
    db.staff.findFirst.mockImplementation(async ({ where }: { where: { userId: string } }) => (where.userId === 'u-wife' ? { id: 's-wife' } : null));
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'AMBIGUOUS' });
    // Every query carries the school.
    for (const [arg] of db.staff.findFirst.mock.calls) expect(arg.where).toMatchObject({ schoolId: A });
  });

  it('SUBSTITUTE: a teacher on the phone who is not the one on THIS substitution is NOT_ALLOWED, and the teacher lookup carries the school', async () => {
    profiles.resolve.mockResolvedValue([profile('u-kavya', 'TEACHER', 'TEACHER')]);
    db.substitution.findFirst.mockResolvedValue({ substituteTeacherId: 't-ramesh' });
    db.teacher.findFirst.mockResolvedValue({ userId: 'u-ramesh' });
    expect(await svc().actorFor(PHONE, A, { kind: 'SUBSTITUTE', substitutionId: 'sub-2' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
    expect(db.teacher.findFirst).toHaveBeenCalledWith({ where: { id: 't-ramesh', schoolId: A }, select: { userId: true } });
  });

  it('SUBSTITUTE on a substitution that is not in this school (findFirst scoped by school → null) is NOT_ALLOWED', async () => {
    profiles.resolve.mockResolvedValue([profile('u-ramesh', 'TEACHER', 'TEACHER')]);
    db.substitution.findFirst.mockResolvedValue(null);
    expect(await svc().actorFor(PHONE, A, { kind: 'SUBSTITUTE', substitutionId: 'sub-of-b' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
    expect(db.teacher.findFirst).not.toHaveBeenCalled();
  });

  it('TEACHER: the login of that named teacher (the one a card was sent to), whatever the gap says now', async () => {
    profiles.resolve.mockResolvedValue([profile('u-head', 'ADMIN', 'SCHOOL_ADMIN'), profile('u-ramesh', 'TEACHER', 'TEACHER')]);
    db.teacher.findFirst.mockResolvedValue({ userId: 'u-ramesh' });
    expect(await svc().actorFor(PHONE, A, { kind: 'TEACHER', teacherId: 't-ramesh' })).toEqual({ ok: true, profile: expect.objectContaining({ userId: 'u-ramesh' }) });
    expect(db.teacher.findFirst).toHaveBeenCalledWith({ where: { id: 't-ramesh', schoolId: A }, select: { userId: true } });
    // It never asks about the gap: the card's teacher is who it was sent to.
    expect(db.substitution.findFirst).not.toHaveBeenCalled();
  });

  it('TEACHER: another teacher on the phone, a teacher of another school, or one with no login is NOT_ALLOWED', async () => {
    profiles.resolve.mockResolvedValue([profile('u-kavya', 'TEACHER', 'TEACHER')]);
    db.teacher.findFirst.mockResolvedValue({ userId: 'u-ramesh' });
    expect(await svc().actorFor(PHONE, A, { kind: 'TEACHER', teacherId: 't-ramesh' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
    db.teacher.findFirst.mockResolvedValue(null);
    expect(await svc().actorFor(PHONE, A, { kind: 'TEACHER', teacherId: 't-of-b' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
    db.teacher.findFirst.mockResolvedValue({ userId: null });
    expect(await svc().actorFor(PHONE, A, { kind: 'TEACHER', teacherId: 't-nologin' })).toEqual({ ok: false, why: 'NOT_ALLOWED' });
  });

  it('a number whose only login at this school is switched off is INACTIVE — counted in THIS school only', async () => {
    profiles.resolve.mockResolvedValue([]);
    db.user.count.mockResolvedValue(1);
    expect(await svc().actorFor('+91 98290 11223', A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'INACTIVE' });
    expect(db.user.count).toHaveBeenCalledWith({ where: { schoolId: A, phone: '+919829011223', isActive: false } });
  });

  it('a person at ANOTHER school only is NO_PROFILE — the lookup is scoped to this school, and a stray profile of B never acts at A', async () => {
    // The scoped resolve finds nothing at A …
    profiles.resolve.mockResolvedValue([]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'NO_PROFILE' });
    expect(profiles.resolve).toHaveBeenCalledWith(PHONE, { schoolId: A });
    // … and even if a B profile leaked through, it is dropped before the need is checked.
    profiles.resolve.mockResolvedValue([{ ...profile('u-admin-b', 'ADMIN', 'SCHOOL_ADMIN'), schoolId: B }]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'NO_PROFILE' });
  });

  // ── One login, several profiles: one person, never AMBIGUOUS ───────────

  it('LEAVE_DESK: one admin login that comes back twice (admin + teacher row) is ok, and the ADMIN profile is the one returned', async () => {
    profiles.resolve.mockResolvedValue([profile('u-head', 'TEACHER', 'SCHOOL_ADMIN'), profile('u-head', 'ADMIN', 'SCHOOL_ADMIN')]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: true, profile: expect.objectContaining({ userId: 'u-head', kind: 'ADMIN' }) });
  });

  it('SUBSTITUTE: the covering teacher\'s login that comes back twice is ok', async () => {
    profiles.resolve.mockResolvedValue([profile('u-ramesh', 'TEACHER', 'TEACHER'), { ...profile('u-ramesh', 'TEACHER', 'TEACHER'), label: 'Ramesh (2)' }]);
    db.substitution.findFirst.mockResolvedValue({ substituteTeacherId: 't-ramesh' });
    db.teacher.findFirst.mockResolvedValue({ userId: 'u-ramesh' });
    expect(await svc().actorFor(PHONE, A, { kind: 'SUBSTITUTE', substitutionId: 'sub-1' })).toEqual({ ok: true, profile: expect.objectContaining({ userId: 'u-ramesh', label: 'u-ramesh' }) });
  });

  it('two DIFFERENT logins, each listed twice, are still AMBIGUOUS', async () => {
    profiles.resolve.mockResolvedValue([
      profile('u-1', 'ADMIN', 'SCHOOL_ADMIN'), profile('u-1', 'TEACHER', 'SCHOOL_ADMIN'),
      profile('u-2', 'ADMIN', 'SCHOOL_ADMIN'), profile('u-2', 'ADMIN', 'SCHOOL_ADMIN'),
    ]);
    expect(await svc().actorFor(PHONE, A, { kind: 'LEAVE_DESK' })).toEqual({ ok: false, why: 'AMBIGUOUS' });
  });

  it.each(['+91 98290 11223', '919829011223', '09829011223', '98290 11223', '+91-98290-11223'])(
    'the phone "%s" reaches the profile lookup as +919829011223',
    async (raw) => {
      profiles.resolve.mockResolvedValue([profile('u-head', 'ADMIN', 'SCHOOL_ADMIN')]);
      expect((await svc().actorFor(raw, A, { kind: 'LEAVE_DESK' })).ok).toBe(true);
      expect(profiles.resolve).toHaveBeenCalledWith('+919829011223', { schoolId: A });
    },
  );
});
