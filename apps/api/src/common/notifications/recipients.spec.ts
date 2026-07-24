import { resolveSchoolRecipients, resolveSectionRecipients, resolveStudentRecipients } from './recipients';

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
      where: { schoolId: SCHOOL, classSectionId: 'cs-1', userId: { not: null } },
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
      where: { schoolId: SCHOOL, userId: { not: null } },
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
      where: { schoolId: SCHOOL, id: { in: ['s-1', 's-2'] }, userId: { not: null } },
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
