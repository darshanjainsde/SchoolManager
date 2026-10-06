import { resolveLeaveDeskRecipients, resolveRecipientUsers, resolveSchoolRecipients, resolveSectionRecipients, resolveStudentRecipients } from './recipients';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function fakeDb() {
  return {
    student: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
  };
}

describe('resolveSectionRecipients', () => {
  it('resolves emails only for students with a linked userId, silently skipping the rest', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }]);
    db.user.findMany.mockResolvedValue([
      { id: 'u-1', email: 'a@x.com' },
      { id: 'u-2', email: 'b@x.com' },
    ]);

    const emails = await resolveSectionRecipients(db as never, SCHOOL, 'cs-1');

    expect(db.student.findMany).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, status: 'ACTIVE', classSectionId: 'cs-1', userId: { not: null } },
      select: { userId: true },
    });
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u-1', 'u-2'] }, schoolId: SCHOOL },
      select: { id: true, email: true },
    });
    expect(emails).toEqual(['a@x.com', 'b@x.com']);
  });

  it('scopes both lookups to the school so the RLS-bypassing cron client cannot cross tenants', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    db.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'a@x.com' }]);

    await resolveSectionRecipients(db as never, SCHOOL, 'cs-1');

    expect(db.student.findMany.mock.calls[0][0].where.schoolId).toBe(SCHOOL);
    expect(db.user.findMany.mock.calls[0][0].where.schoolId).toBe(SCHOOL);
  });

  it('returns an empty list without querying users when no student in the section has a linked userId', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([]);

    const emails = await resolveSectionRecipients(db as never, SCHOOL, 'cs-1');

    expect(emails).toEqual([]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveSchoolRecipients', () => {
  it('resolves emails for every linked-user student in the school, not scoped to any class section', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }]);
    db.user.findMany.mockResolvedValue([
      { id: 'u-1', email: 'a@x.com' },
      { id: 'u-2', email: 'b@x.com' },
    ]);

    const emails = await resolveSchoolRecipients(db as never, SCHOOL);

    expect(db.student.findMany).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, status: 'ACTIVE', userId: { not: null } },
      select: { userId: true },
    });
    expect(emails).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns an empty list without querying users when no student in the school has a linked userId', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([]);

    const emails = await resolveSchoolRecipients(db as never, SCHOOL);

    expect(emails).toEqual([]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveStudentRecipients', () => {
  it('resolves each linked-user email together with that student\'s name', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([
      { userId: 'u-9', firstName: 'Aisha', lastName: 'Khan' },
      { userId: 'u-8', firstName: 'Rohan', lastName: 'Mehta' },
    ]);
    db.user.findMany.mockResolvedValue([
      { id: 'u-9', email: 'aisha.parent@x.com' },
      { id: 'u-8', email: 'rohan.parent@x.com' },
    ]);

    const recipients = await resolveStudentRecipients(db as never, SCHOOL, ['s-1', 's-2']);

    expect(db.student.findMany).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, status: 'ACTIVE', id: { in: ['s-1', 's-2'] }, userId: { not: null } },
      select: { userId: true, firstName: true, lastName: true },
    });
    expect(recipients).toEqual([
      { email: 'aisha.parent@x.com', studentName: 'Aisha Khan' },
      { email: 'rohan.parent@x.com', studentName: 'Rohan Mehta' },
    ]);
  });

  it('skips a student whose linked user row has no reachable email', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([
      { userId: 'u-9', firstName: 'Aisha', lastName: 'Khan' },
      { userId: 'u-7', firstName: 'Ghost', lastName: 'Student' },
    ]);
    db.user.findMany.mockResolvedValue([{ id: 'u-9', email: 'aisha.parent@x.com' }]);

    const recipients = await resolveStudentRecipients(db as never, SCHOOL, ['s-1', 's-2']);

    expect(recipients).toEqual([{ email: 'aisha.parent@x.com', studentName: 'Aisha Khan' }]);
  });

  it('returns an empty list without any query for an empty studentIds list', async () => {
    const db = fakeDb();

    const recipients = await resolveStudentRecipients(db as never, SCHOOL, []);

    expect(recipients).toEqual([]);
    expect(db.student.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveRecipientUsers — who an outbox row is for, by login id', () => {
  it('a single-reader row is that one login, if it has an email at this school', async () => {
    const db = fakeDb();
    db.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'a@x.com' }]);
    expect(await resolveRecipientUsers(db as never, SCHOOL, { targetUserId: 'u-1', classSectionId: null })).toEqual(['u-1']);
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['u-1'] }, schoolId: SCHOOL }, select: { id: true, email: true } });
    expect(db.student.findMany).not.toHaveBeenCalled();
  });

  it('a class row is every active linked student login of the section, once each', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }, { userId: 'u-1' }]);
    db.user.findMany.mockResolvedValue([{ id: 'u-1', email: 'a@x.com' }]);
    expect(await resolveRecipientUsers(db as never, SCHOOL, { targetUserId: null, classSectionId: 'cs-1' })).toEqual(['u-1']);
    expect(db.student.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: SCHOOL, classSectionId: 'cs-1' });
  });

  it('a row with neither is nobody', async () => {
    const db = fakeDb();
    expect(await resolveRecipientUsers(db as never, SCHOOL, { targetUserId: null, classSectionId: null })).toEqual([]);
  });
});

describe('resolveLeaveDeskRecipients — the people LeaveDeskGuard lets in', () => {
  function deskDb() {
    return { user: { findMany: jest.fn() }, staff: { findMany: jest.fn() }, student: { findMany: jest.fn() } };
  }

  it('every active admin plus every active accounts officer with a login, once each', async () => {
    const db = deskDb();
    db.user.findMany
      .mockResolvedValueOnce([{ id: 'u-head', email: 'head@x' }]) // admins
      .mockResolvedValueOnce([{ id: 'u-acc', email: 'accounts@x' }]); // officers' logins
    db.staff.findMany.mockResolvedValue([{ userId: 'u-acc' }, { userId: 'u-head' }]);
    expect(await resolveLeaveDeskRecipients(db as never, SCHOOL)).toEqual([
      { userId: 'u-head', email: 'head@x' },
      { userId: 'u-acc', email: 'accounts@x' },
    ]);
    expect(db.staff.findMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, role: 'ACCOUNTS', isActive: true, userId: { not: null } }, select: { userId: true } });
    // The admin who is also on the accounts roll is not asked about twice.
    expect(db.user.findMany.mock.calls[1][0]).toEqual({ where: { schoolId: SCHOOL, id: { in: ['u-acc'] }, isActive: true }, select: { id: true, email: true } });
  });

  it('no officer: just the admins, and no second query', async () => {
    const db = deskDb();
    db.user.findMany.mockResolvedValueOnce([{ id: 'u-head', email: 'head@x' }]);
    db.staff.findMany.mockResolvedValue([]);
    expect(await resolveLeaveDeskRecipients(db as never, SCHOOL)).toEqual([{ userId: 'u-head', email: 'head@x' }]);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('the same officer on two Staff rows is one recipient', async () => {
    const db = deskDb();
    db.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'u-acc', email: 'accounts@x' }]);
    db.staff.findMany.mockResolvedValue([{ userId: 'u-acc' }, { userId: 'u-acc' }]);
    expect(await resolveLeaveDeskRecipients(db as never, SCHOOL)).toEqual([{ userId: 'u-acc', email: 'accounts@x' }]);
    expect(db.user.findMany.mock.calls[1][0].where.id).toEqual({ in: ['u-acc'] });
  });

  it('never includes the applicant: an officer applying for her own leave is not asked to approve it', async () => {
    const db = deskDb();
    db.user.findMany.mockResolvedValueOnce([{ id: 'u-head', email: 'head@x' }]);
    db.staff.findMany.mockResolvedValue([{ userId: 'u-acc' }]);
    expect(await resolveLeaveDeskRecipients(db as never, SCHOOL, { exceptUserId: 'u-acc' })).toEqual([{ userId: 'u-head', email: 'head@x' }]);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('an admin who applies is left out too, and is not re-added through the accounts roll', async () => {
    const db = deskDb();
    db.user.findMany.mockResolvedValueOnce([{ id: 'u-head', email: 'head@x' }, { id: 'u-other', email: 'other@x' }]);
    db.staff.findMany.mockResolvedValue([{ userId: 'u-head' }]);
    expect(await resolveLeaveDeskRecipients(db as never, SCHOOL, { exceptUserId: 'u-head' })).toEqual([{ userId: 'u-other', email: 'other@x' }]);
    expect(db.user.findMany).toHaveBeenCalledTimes(1);
  });
});
