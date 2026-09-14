import 'reflect-metadata';

const txMock = {
  school: { findUnique: jest.fn() },
  libraryIssue: { findMany: jest.fn(), updateMany: jest.fn() },
  notification: { createMany: jest.fn() },
  notificationOutbox: { createMany: jest.fn() },
  user: { findMany: jest.fn() },
};
const background: Promise<unknown>[] = [];
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));
jest.mock('../../../common/notifications/run-in-background', () => ({
  runInBackground: (work: () => Promise<unknown>, onError: (e: unknown) => void) => {
    background.push(Promise.resolve(work()).catch(onError));
  },
}));

import { LibraryYearEndService } from './library-year-end.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const RULES = { studentLoanLimit: 2, teacherLoanLimit: 5, loanDays: 14, finePerDayRupees: 2, graceDays: 3, lostFeeRupees: 300, fineTeachers: false };
const settings = { ensure: jest.fn().mockResolvedValue({}), rules: jest.fn().mockReturnValue(RULES) };
const mail = { sendLetter: jest.fn().mockResolvedValue(true) };
const audit = { record: jest.fn().mockResolvedValue(undefined) };
const svc = () => new LibraryYearEndService(settings as never, mail as never, audit as never);

// "Today" is 2026-03-25 IST.
const NOW = new Date('2026-03-25T04:00:00Z');
const issue = (id: string, dueOn: string, userId: string | null = 'u1') => ({
  id, issuedOn: new Date('2026-03-01T00:00:00Z'), dueOn: new Date(`${dueOn}T00:00:00Z`),
  copy: { accessionNo: `B-${id}`, title: { title: `Book ${id}` } },
  student: { id: `s-${id}`, firstName: 'Aarav', lastName: 'M', code: 'RAF-1', userId, classSection: { name: 'B', grade: { name: '5' } } },
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
  background.length = 0;
  txMock.school.findUnique.mockResolvedValue({ name: 'Raffles', timezone: 'Asia/Kolkata' });
});
afterEach(() => jest.useRealTimers());

describe('openLoans', () => {
  it('lists every open student loan with the fine so far, and marks the ones due after the session', async () => {
    txMock.libraryIssue.findMany.mockResolvedValue([issue('a', '2026-03-10'), issue('b', '2026-03-24'), issue('c', '2026-04-05', null)]);
    const r = await svc().openLoans(SCHOOL, new Date('2026-03-31T00:00:00Z'));
    expect(r.today).toBe('2026-03-25');
    // 15 days late, 3 grace, ₹2/day → ₹24; one day late → inside grace → ₹0; not yet due → ₹0.
    expect(r.rows.map((x) => [x.issueId, x.daysLate, x.fineRupees, x.dueAfterSession])).toEqual([['a', 15, 24, false], ['b', 1, 0, false], ['c', 0, 0, true]]);
    expect(r.counts).toEqual({ out: 3, overdue: 2, dueAfterSession: 1, noLogin: 1, accruingRupees: 24 });
    expect(txMock.libraryIssue.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: SCHOOL, returnedOn: null, wasLost: false, student: { status: 'ACTIVE' } });
  });
});

describe('remindOpenLoans', () => {
  it('writes one bell row and one push row per family with a login, mails the ones with an address, and counts the rest', async () => {
    txMock.libraryIssue.findMany.mockResolvedValue([issue('a', '2026-03-10'), issue('c', '2026-04-05', null)]);
    txMock.user.findMany.mockResolvedValue([{ id: 'u1', email: 'fam@x.in' }]);
    const r = await svc().remindOpenLoans(SCHOOL, ACTOR);
    await Promise.all(background);
    expect(r).toEqual({ reminded: 1, noLogin: 1 });
    expect(txMock.notification.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ userId: 'u1', kind: 'LIBRARY', title: '“Book a” is still out', body: expect.stringContaining('fine so far ₹24') })]);
    expect(txMock.notificationOutbox.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ kind: 'LIBRARY_NOTICE', targetUserId: 'u1' })]);
    expect(mail.sendLetter).toHaveBeenCalledWith('fam@x.in', SCHOOL, expect.stringContaining('still out'), expect.objectContaining({ title: 'A library book is still out' }));
  });
});

describe('capDueDates', () => {
  it('brings only the loans due AFTER the chosen day forward to it, never a past day', async () => {
    txMock.libraryIssue.updateMany.mockResolvedValue({ count: 7 });
    const r = await svc().capDueDates(SCHOOL, ACTOR, '2026-03-31');
    expect(r).toEqual({ changed: 7, lastDueOn: '2026-03-31' });
    expect(txMock.libraryIssue.updateMany).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL, returnedOn: null, wasLost: false, studentId: { not: null }, dueOn: { gt: new Date('2026-03-31T00:00:00.000Z') } },
      data: { dueOn: new Date('2026-03-31T00:00:00.000Z') },
    });
    await expect(svc().capDueDates(SCHOOL, ACTOR, '2026-03-24')).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
    await expect(svc().capDueDates(SCHOOL, ACTOR, 'tomorrow')).rejects.toMatchObject({ response: { code: 'VALIDATION' } });
  });
});
