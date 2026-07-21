import { resolveSectionRecipients, resolveStudentRecipients } from './recipients';

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
    db.user.findMany.mockResolvedValue([{ email: 'a@x.com' }, { email: 'b@x.com' }]);

    const emails = await resolveSectionRecipients(db as never, 'cs-1');

    expect(db.student.findMany).toHaveBeenCalledWith({
      where: { classSectionId: 'cs-1', userId: { not: null } },
      select: { userId: true },
    });
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u-1', 'u-2'] } },
      select: { email: true },
    });
    expect(emails).toEqual(['a@x.com', 'b@x.com']);
  });

  it('returns an empty list without querying users when no student in the section has a linked userId', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([]);

    const emails = await resolveSectionRecipients(db as never, 'cs-1');

    expect(emails).toEqual([]);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});

describe('resolveStudentRecipients', () => {
  it('resolves emails only for the given student ids that have a linked userId', async () => {
    const db = fakeDb();
    db.student.findMany.mockResolvedValue([{ userId: 'u-9' }]);
    db.user.findMany.mockResolvedValue([{ email: 'guardian@x.com' }]);

    const emails = await resolveStudentRecipients(db as never, ['s-1', 's-2']);

    expect(db.student.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-1', 's-2'] }, userId: { not: null } },
      select: { userId: true },
    });
    expect(emails).toEqual(['guardian@x.com']);
  });

  it('returns an empty list without any query for an empty studentIds list', async () => {
    const db = fakeDb();

    const emails = await resolveStudentRecipients(db as never, []);

    expect(emails).toEqual([]);
    expect(db.student.findMany).not.toHaveBeenCalled();
  });
});
