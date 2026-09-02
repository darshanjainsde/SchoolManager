import 'reflect-metadata';

const txMock = {
  librarySettings: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  libraryIssue: {
    count: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    groupBy: jest.fn(),
  },
  libraryBookCopy: { findFirst: jest.fn(), update: jest.fn(), count: jest.fn() },
  libraryBookTitle: { count: jest.fn() },
  libraryFine: {
    create: jest.fn(),
    deleteMany: jest.fn(),
    aggregate: jest.fn(),
    findMany: jest.fn(),
  },
  student: { findFirst: jest.fn(), findMany: jest.fn() },
  teacher: { findFirst: jest.fn(), findMany: jest.fn() },
  $queryRaw: jest.fn(),
};
const withTenantMock = jest.fn((_schoolId: string, fn: (tx: unknown) => unknown) => fn(txMock));

jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { Prisma } from '@skoolos/db';
import { LibraryCirculationService } from './library-circulation.service';
import { LibrarySettingsService } from './library-settings.service';
import { ApiError } from '../../../common/errors/api-error';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LIBRARIAN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STUDENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const COPY = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const TITLE = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const ISSUE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const SETTINGS = {
  id: 'set', schoolId: SCHOOL,
  hallCapacityClasses: 2, studentLoanLimit: 2, teacherLoanLimit: 5,
  loanDays: 14, finePerDayRupees: 5, graceDays: 1, lostFeeRupees: 120,
  fineTeachers: false, dueSoonReminders: true,
  createdAt: new Date(), updatedAt: new Date(),
};

const STUDENT_ROW = {
  id: STUDENT, firstName: 'Ananya', lastName: 'Rao', code: 'RVS-00231',
  classSectionId: 'sec1',
  classSection: { name: 'A', grade: { name: '6' } },
};

function issueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ISSUE,
    issuedOn: new Date('2026-08-02T00:00:00.000Z'),
    dueOn: new Date('2026-08-16T00:00:00.000Z'),
    returnedOn: null,
    wasLost: false,
    studentId: STUDENT,
    teacherId: null,
    copy: { accessionNo: 'B-00042', title: { id: TITLE, title: 'Matilda', author: 'Roald Dahl' } },
    student: STUDENT_ROW,
    teacher: null,
    ...overrides,
  };
}

function expectApiCode(e: unknown, code: string) {
  expect(e).toBeInstanceOf(ApiError);
  expect((e as ApiError).getResponse()).toMatchObject({ code });
}

describe('LibraryCirculationService', () => {
  let svc: LibraryCirculationService;

  beforeEach(() => {
    jest.clearAllMocks();
    txMock.librarySettings.findUnique.mockResolvedValue(SETTINGS);
    txMock.student.findFirst.mockResolvedValue(STUDENT_ROW);
    txMock.$queryRaw.mockResolvedValue([]);
    svc = new LibraryCirculationService(new LibrarySettingsService());
  });

  describe('memberSearch', () => {
    it('a full-name query also matches firstName + lastName split across the words', async () => {
      txMock.student.findMany.mockResolvedValue([]);
      txMock.teacher.findMany.mockResolvedValue([]);
      txMock.libraryIssue.groupBy.mockResolvedValue([]);

      await svc.memberSearch(SCHOOL, 'Kavya Rao');

      const studentWhere = txMock.student.findMany.mock.calls[0][0].where;
      expect(studentWhere.OR).toEqual(
        expect.arrayContaining([
          {
            AND: [
              { firstName: { contains: 'Kavya', mode: 'insensitive' } },
              { lastName: { contains: 'Rao', mode: 'insensitive' } },
            ],
          },
        ]),
      );
      const teacherWhere = txMock.teacher.findMany.mock.calls[0][0].where;
      expect(teacherWhere.OR).toEqual(
        expect.arrayContaining([
          {
            AND: [
              { firstName: { contains: 'Kavya', mode: 'insensitive' } },
              { lastName: { contains: 'Rao', mode: 'insensitive' } },
            ],
          },
        ]),
      );
    });
  });

  describe('issue', () => {
    it('rejects zero or two borrowers, and zero or two book pickers', async () => {
      await expect(svc.issue(SCHOOL, LIBRARIAN, { titleId: TITLE })).rejects.toBeInstanceOf(ApiError);
      await expect(
        svc.issue(SCHOOL, LIBRARIAN, { titleId: TITLE, studentId: STUDENT, teacherId: STUDENT }),
      ).rejects.toBeInstanceOf(ApiError);
      await expect(svc.issue(SCHOOL, LIBRARIAN, { studentId: STUDENT })).rejects.toBeInstanceOf(ApiError);
      await expect(
        svc.issue(SCHOOL, LIBRARIAN, { studentId: STUDENT, copyId: COPY, titleId: TITLE }),
      ).rejects.toBeInstanceOf(ApiError);
    });

    it('takes the per-borrower advisory lock before counting', async () => {
      txMock.libraryIssue.count.mockResolvedValue(0);
      txMock.libraryBookCopy.findFirst.mockResolvedValue({ id: COPY, titleId: TITLE });
      txMock.libraryIssue.findFirst.mockResolvedValue(null);
      txMock.libraryIssue.create.mockResolvedValue(issueRow());
      await svc.issue(SCHOOL, LIBRARIAN, { studentId: STUDENT, titleId: TITLE });
      expect(txMock.$queryRaw).toHaveBeenCalled();
      const lockOrder = txMock.$queryRaw.mock.invocationCallOrder[0];
      const countOrder = txMock.libraryIssue.count.mock.invocationCallOrder[0];
      expect(lockOrder).toBeLessThan(countOrder);
    });

    it('at the limit: 409 LIBRARY_LIMIT without override, issues with it', async () => {
      txMock.libraryIssue.count.mockResolvedValue(2);
      txMock.libraryBookCopy.findFirst.mockResolvedValue({ id: COPY, titleId: TITLE });
      txMock.libraryIssue.findFirst.mockResolvedValue(null);
      txMock.libraryIssue.create.mockResolvedValue(issueRow());

      try {
        await svc.issue(SCHOOL, LIBRARIAN, { studentId: STUDENT, titleId: TITLE });
        throw new Error('should have thrown');
      } catch (e) {
        expectApiCode(e, 'LIBRARY_LIMIT');
      }
      expect(txMock.libraryIssue.create).not.toHaveBeenCalled();

      const card = await svc.issue(SCHOOL, LIBRARIAN, {
        studentId: STUDENT, titleId: TITLE, override: true,
      });
      expect(card.title).toBe('Matilda');
      expect(txMock.libraryIssue.create).toHaveBeenCalled();
    });

    it('already holds the title: 409 LIBRARY_DUPLICATE_TITLE unless overridden', async () => {
      txMock.libraryIssue.count.mockResolvedValue(1);
      txMock.libraryBookCopy.findFirst.mockResolvedValue({ id: COPY, titleId: TITLE });
      txMock.libraryIssue.findFirst.mockResolvedValue({ id: 'other-open-issue' });
      try {
        await svc.issue(SCHOOL, LIBRARIAN, { studentId: STUDENT, titleId: TITLE });
        throw new Error('should have thrown');
      } catch (e) {
        expectApiCode(e, 'LIBRARY_DUPLICATE_TITLE');
      }
    });

    it('no free copy: 409 LIBRARY_UNAVAILABLE naming the earliest return', async () => {
      txMock.libraryIssue.count.mockResolvedValue(0);
      txMock.libraryBookCopy.findFirst.mockResolvedValue(null);
      txMock.libraryIssue.findFirst.mockResolvedValue({ dueOn: new Date('2026-08-20T00:00:00.000Z') });
      try {
        await svc.issue(SCHOOL, LIBRARIAN, { studentId: STUDENT, titleId: TITLE });
        throw new Error('should have thrown');
      } catch (e) {
        expectApiCode(e, 'LIBRARY_UNAVAILABLE');
        expect((e as ApiError).message).toContain('2026-08-20');
      }
    });

    it('a losing race on the open-copy index maps P2002 → LIBRARY_UNAVAILABLE', async () => {
      txMock.libraryIssue.count.mockResolvedValue(0);
      txMock.libraryBookCopy.findFirst.mockResolvedValue({ id: COPY, titleId: TITLE });
      txMock.libraryIssue.findFirst.mockResolvedValue(null);
      txMock.libraryIssue.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }),
      );
      try {
        await svc.issue(SCHOOL, LIBRARIAN, { studentId: STUDENT, titleId: TITLE });
        throw new Error('should have thrown');
      } catch (e) {
        expectApiCode(e, 'LIBRARY_UNAVAILABLE');
      }
    });
  });

  describe('return / undo', () => {
    it('a late return crystallizes a DUE LATE fine for the accrued amount', async () => {
      // dueOn far in the past → definitely late beyond grace.
      txMock.libraryIssue.findFirst.mockResolvedValue(issueRow({ dueOn: new Date('2020-01-01T00:00:00.000Z') }));
      txMock.libraryIssue.update.mockResolvedValue(issueRow({ returnedOn: new Date() }));
      txMock.libraryFine.create.mockResolvedValue({ id: 'fine1' });

      const res = await svc.returnIssue(SCHOOL, LIBRARIAN, ISSUE);
      expect(res.fineRupees).toBeGreaterThan(0);
      expect(txMock.libraryFine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'LATE', studentId: STUDENT, amountRupees: res.fineRupees }),
        }),
      );
    });

    it('an on-time return writes no fine row at all', async () => {
      const future = new Date();
      future.setUTCDate(future.getUTCDate() + 5);
      txMock.libraryIssue.findFirst.mockResolvedValue(issueRow({ dueOn: future }));
      txMock.libraryIssue.update.mockResolvedValue(issueRow({ returnedOn: new Date(), dueOn: future }));
      const res = await svc.returnIssue(SCHOOL, LIBRARIAN, ISSUE);
      expect(res.fineRupees).toBe(0);
      expect(txMock.libraryFine.create).not.toHaveBeenCalled();
    });

    it('a teacher return while fineTeachers is off writes no fine', async () => {
      txMock.libraryIssue.findFirst.mockResolvedValue(
        issueRow({
          studentId: null,
          teacherId: 't1',
          student: null,
          teacher: { id: 't1', firstName: 'Farid', lastName: 'Khan' },
          dueOn: new Date('2020-01-01T00:00:00.000Z'),
        }),
      );
      txMock.libraryIssue.update.mockResolvedValue(issueRow({ returnedOn: new Date() }));
      const res = await svc.returnIssue(SCHOOL, LIBRARIAN, ISSUE);
      expect(res.fineRupees).toBe(0);
      expect(txMock.libraryFine.create).not.toHaveBeenCalled();
    });

    it('returning an already-returned loan is LIBRARY_NOT_OPEN', async () => {
      txMock.libraryIssue.findFirst.mockResolvedValue(issueRow({ returnedOn: new Date() }));
      try {
        await svc.returnIssue(SCHOOL, LIBRARIAN, ISSUE);
        throw new Error('should have thrown');
      } catch (e) {
        expectApiCode(e, 'LIBRARY_NOT_OPEN');
      }
    });

    it('reopen refuses once the fine is settled', async () => {
      txMock.libraryIssue.findFirst.mockResolvedValue(
        issueRow({ returnedOn: new Date(), fines: [{ id: 'f1', status: 'PAID' }] }),
      );
      try {
        await svc.reopen(SCHOOL, ISSUE);
        throw new Error('should have thrown');
      } catch (e) {
        expectApiCode(e, 'LIBRARY_FINE_SETTLED');
      }
    });

    it('reopen deletes the DUE fine and clears the return', async () => {
      txMock.libraryIssue.findFirst.mockResolvedValue(
        issueRow({ returnedOn: new Date(), fines: [{ id: 'f1', status: 'DUE' }] }),
      );
      txMock.libraryFine.deleteMany.mockResolvedValue({ count: 1 });
      txMock.libraryIssue.update.mockResolvedValue(issueRow());
      await svc.reopen(SCHOOL, ISSUE);
      expect(txMock.libraryFine.deleteMany).toHaveBeenCalledWith({ where: { schoolId: SCHOOL, issueId: ISSUE, status: 'DUE' } });
      expect(txMock.libraryIssue.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { returnedOn: null, returnedById: null } }),
      );
    });

    it('void only deletes OPEN issues', async () => {
      txMock.libraryIssue.findFirst.mockResolvedValue({ id: ISSUE, returnedOn: new Date() });
      try {
        await svc.voidIssue(SCHOOL, ISSUE);
        throw new Error('should have thrown');
      } catch (e) {
        expectApiCode(e, 'LIBRARY_NOT_OPEN');
      }
      expect(txMock.libraryIssue.delete).not.toHaveBeenCalled();
    });
  });

  describe('mark lost', () => {
    it('retires the copy, closes the loan, charges the flat fee', async () => {
      txMock.libraryIssue.findFirst.mockResolvedValue(
        issueRow({ copy: { id: COPY, lostAt: null, accessionNo: 'B-00042', title: { id: TITLE, title: 'Matilda', author: 'Roald Dahl' } } }),
      );
      txMock.libraryBookCopy.update.mockResolvedValue({});
      txMock.libraryIssue.update.mockResolvedValue(issueRow({ wasLost: true, returnedOn: new Date() }));
      txMock.libraryFine.create.mockResolvedValue({ id: 'fine2' });
      const res = await svc.markLost(SCHOOL, LIBRARIAN, ISSUE);
      expect(res.fineRupees).toBe(120);
      expect(txMock.libraryBookCopy.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { lostAt: expect.any(Date) } }),
      );
      expect(txMock.libraryFine.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ reason: 'LOST', amountRupees: 120 }) }),
      );
    });

    it('a teacher loss while fineTeachers is off charges nothing', async () => {
      txMock.libraryIssue.findFirst.mockResolvedValue(
        issueRow({
          studentId: null,
          teacherId: 't1',
          student: null,
          teacher: { id: 't1', firstName: 'Farid', lastName: 'Khan' },
          copy: { id: COPY, lostAt: null, accessionNo: 'B-00042', title: { id: TITLE, title: 'Matilda', author: 'Roald Dahl' } },
        }),
      );
      txMock.libraryBookCopy.update.mockResolvedValue({});
      txMock.libraryIssue.update.mockResolvedValue(issueRow({ wasLost: true }));
      const res = await svc.markLost(SCHOOL, LIBRARIAN, ISSUE);
      expect(res.fineRupees).toBe(0);
      expect(txMock.libraryFine.create).not.toHaveBeenCalled();
    });
  });
});
