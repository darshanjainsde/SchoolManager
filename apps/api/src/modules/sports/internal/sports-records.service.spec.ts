import 'reflect-metadata';

const txMock = {
  sportsRecord: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  sportsRecordAttempt: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  sportsSettings: { findUnique: jest.fn() },
  student: { findMany: jest.fn(), findFirst: jest.fn() },
  user: { findFirst: jest.fn() },
  school: { findUnique: jest.fn() },
  notification: { create: jest.fn() },
  notificationOutbox: { create: jest.fn() },
};
const background: Promise<unknown>[] = [];
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@prisma/client'),
  withTenant: (_s: string, fn: (tx: unknown) => unknown) => fn(txMock),
}));
jest.mock('../../../common/notifications/run-in-background', () => ({
  runInBackground: (work: () => Promise<unknown>, onError: (e: unknown) => void) => { background.push(Promise.resolve(work()).catch(onError)); },
}));

import { SportsRecordsService } from './sports-records.service';
import { SportsSettingsService } from './sports-settings.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ACTOR = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const S1 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const AT = '44444444-4444-4444-4444-444444444444';
const settingsRow = { schoolId: SCHOOL, grouping: 'BANDS', bands: [{ id: 'sen', label: 'Senior', stds: [9, 10] }], pointsPlacing: [10], pointsMatchWin: 5, pointsClassWin: 3, publishNeedsAdmin: false, createdAt: new Date(), updatedAt: new Date() };
const mail = { sendLetter: jest.fn().mockResolvedValue(true) };
const audit = { record: jest.fn().mockResolvedValue(undefined) };
const svc = () => new SportsRecordsService(mail as never, audit as never, new SportsSettingsService());
const sprint = { sportKey: 'ath-100m', sportName: '100 m sprint', groupKey: 'sen', category: 'Boys', scoring: { type: 'MARK' as const, label: 'Time', unit: 's' as const, lowerIsBetter: true, precision: 2 } };
const standing = (over: Record<string, unknown> = {}) => ({ id: 'r-old', schoolId: SCHOOL, sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', value: 12.3, unit: 's', holderName: 'Old Holder', holderStudentId: null, setOn: null, sinceYear: 2019, untilYear: null, status: 'STANDING', source: 'IMPORT', note: null, verifiedById: null, createdAt: new Date('2020-01-01'), ...over });
const attempt = (over: Record<string, unknown> = {}) => ({ id: AT, schoolId: SCHOOL, sportKey: 'ath-100m', sportName: '100 m sprint', groupKey: 'sen', category: 'Boys', studentId: S1, value: 12.1, unit: 's', source: 'MEET', witnessed: true, status: 'PENDING', enteredById: ACTOR, decidedById: null, decidedAt: null, createdAt: new Date('2026-09-15T05:00:00Z'), ...over });

beforeEach(() => {
  jest.clearAllMocks();
  background.length = 0;
  txMock.sportsSettings.findUnique.mockResolvedValue(settingsRow);
  txMock.sportsRecord.create.mockResolvedValue({ id: 'r-new' });
  txMock.sportsRecord.update.mockResolvedValue({});
  txMock.sportsRecordAttempt.update.mockResolvedValue({});
  txMock.sportsRecordAttempt.create.mockResolvedValue({ id: AT });
  txMock.student.findFirst.mockResolvedValue({ id: S1, firstName: 'Aarav', lastName: 'M', userId: 'uA' });
  txMock.user.findFirst.mockResolvedValue({ email: 'a@x.in' });
  txMock.school.findUnique.mockResolvedValue({ name: 'Raffles' });
});

describe('noteAttemptIfRecord', () => {
  it('queues only a mark that beats the standing record, and never the same mark twice', async () => {
    txMock.sportsRecord.findFirst.mockResolvedValue({ value: 12.3 });
    expect(await svc().noteAttemptIfRecord(txMock as never, SCHOOL, ACTOR, sprint, S1, 12.4, 'MEET')).toBe(false);
    txMock.sportsRecordAttempt.findFirst.mockResolvedValueOnce({ id: 'dup' });
    expect(await svc().noteAttemptIfRecord(txMock as never, SCHOOL, ACTOR, sprint, S1, 12.1, 'MEET')).toBe(false);
    txMock.sportsRecordAttempt.findFirst.mockResolvedValueOnce(null);
    expect(await svc().noteAttemptIfRecord(txMock as never, SCHOOL, ACTOR, sprint, S1, 12.1, 'MEET')).toBe(true);
    expect(txMock.sportsRecordAttempt.create.mock.calls[0][0].data).toEqual({ schoolId: SCHOOL, sportKey: 'ath-100m', sportName: '100 m sprint', groupKey: 'sen', category: 'Boys', studentId: S1, value: 12.1, unit: 's', source: 'MEET', witnessed: true, enteredById: ACTOR });
    txMock.sportsRecord.findFirst.mockResolvedValue(null);
    txMock.sportsRecordAttempt.findFirst.mockResolvedValueOnce(null);
    expect(await svc().noteAttemptIfRecord(txMock as never, SCHOOL, ACTOR, sprint, S1, 20, 'MEET')).toBe(true); // an empty line: anything is a first record
  });
});

describe('submit', () => {
  it('only measured sports, only students on the roll; says whether it beats the book', async () => {
    await expect(svc().submit(SCHOOL, ACTOR, { sportKey: 'badminton', groupKey: 'sen', category: 'Boys', studentId: S1, value: 1, source: 'PRACTICE', witnessed: false })).rejects.toMatchObject({ response: { code: 'UNKNOWN_SPORT' } });
    txMock.student.findFirst.mockResolvedValueOnce(null);
    await expect(svc().submit(SCHOOL, ACTOR, { sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', studentId: S1, value: 12, source: 'PRACTICE', witnessed: false })).rejects.toMatchObject({ response: { field: 'studentId' } });
    txMock.sportsRecord.findFirst.mockResolvedValue({ value: 12.3 });
    expect(await svc().submit(SCHOOL, ACTOR, { sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', studentId: S1, value: 12.9, source: 'TRIAL', witnessed: true })).toEqual({ id: AT, beatsStanding: false });
    expect(txMock.sportsRecordAttempt.create.mock.calls[0][0].data).toMatchObject({ source: 'TRIAL', witnessed: true, value: 12.9 });
  });
});

describe('decide', () => {
  it('a decided attempt stays decided; a rejection is closed with a note in the audit', async () => {
    txMock.sportsRecordAttempt.findFirst.mockResolvedValueOnce(attempt({ status: 'APPROVED' }));
    await expect(svc().decide(SCHOOL, ACTOR, AT, { approve: true })).rejects.toMatchObject({ response: { code: 'ATTEMPT_DECIDED' } });
    txMock.sportsRecordAttempt.findFirst.mockResolvedValueOnce(attempt());
    expect(await svc().decide(SCHOOL, ACTOR, AT, { approve: false, note: 'Wind-assisted' })).toEqual({ status: 'REJECTED', recordId: null });
    expect(txMock.sportsRecordAttempt.update.mock.calls[0][0].data).toMatchObject({ status: 'REJECTED', decidedById: ACTOR });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sports.record.reject', meta: { note: 'Wind-assisted' } }));
    expect(txMock.sportsRecord.create).not.toHaveBeenCalled();
  });

  it('approval retires the standing record, writes the new one, tells the child and posts the letter in the background', async () => {
    txMock.sportsRecordAttempt.findFirst.mockResolvedValueOnce(attempt());
    txMock.sportsRecord.findFirst.mockResolvedValueOnce(standing());
    const r = await svc().decide(SCHOOL, ACTOR, AT, { approve: true });
    expect(r).toEqual({ status: 'APPROVED', recordId: 'r-new' });
    expect(txMock.sportsRecord.update).toHaveBeenCalledWith({ where: { id: 'r-old' }, data: { status: 'BROKEN', untilYear: expect.any(Number) } });
    expect(txMock.sportsRecord.create.mock.calls[0][0].data).toMatchObject({ sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', value: 12.1, unit: 's', holderName: 'Aarav M', holderStudentId: S1, status: 'STANDING', source: 'MEET', verifiedById: ACTOR, setOn: new Date('2026-09-15T00:00:00Z') });
    expect(txMock.sportsRecordAttempt.update.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED' });
    expect(txMock.notification.create.mock.calls[0][0].data).toMatchObject({ userId: 'uA', kind: 'SPORTS', title: 'School record: 100 m sprint', body: '12.10 s — you beat the Senior Boys record of 12.30 s (Old Holder, 2019).', linkType: 'records', linkId: 'r-new' });
    expect(txMock.notificationOutbox.create.mock.calls[0][0].data).toMatchObject({ kind: 'SPORTS_NOTICE', targetUserId: 'uA' });
    await Promise.all(background);
    expect(mail.sendLetter).toHaveBeenCalledWith('a@x.in', SCHOOL, 'Raffles — School record: 100 m sprint', expect.objectContaining({ title: 'School record: 100 m sprint' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'sports.record.approve', entityId: 'r-new' }));
  });

  it('an attempt overtaken by a better approval is rejected instead of rewriting the book backwards; a first record has its own line', async () => {
    txMock.sportsRecordAttempt.findFirst.mockResolvedValueOnce(attempt({ value: 12.2 }));
    txMock.sportsRecord.findFirst.mockResolvedValueOnce(standing({ value: 12.15 }));
    expect(await svc().decide(SCHOOL, ACTOR, AT, { approve: true })).toEqual({ status: 'REJECTED', recordId: null });
    expect(txMock.sportsRecord.create).not.toHaveBeenCalled();
    txMock.sportsRecordAttempt.findFirst.mockResolvedValueOnce(attempt());
    txMock.sportsRecord.findFirst.mockResolvedValueOnce(null);
    await svc().decide(SCHOOL, ACTOR, AT, { approve: true });
    expect(txMock.notification.create.mock.calls[0][0].data.body).toBe('12.10 s — the first Senior Boys record in the book. Your name is in it.');
  });
});

describe('add / void', () => {
  it('a past record goes in as history; a standing one must beat the book, and retires the old holder', async () => {
    await svc().add(SCHOOL, ACTOR, { sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', value: 12.9, holderName: 'R. Iyer', sinceYear: 2010, untilYear: 2019 });
    expect(txMock.sportsRecord.create.mock.calls[0][0].data).toMatchObject({ status: 'BROKEN', untilYear: 2019, sinceYear: 2010, holderName: 'R. Iyer', source: 'IMPORT' });
    txMock.sportsRecord.findFirst.mockResolvedValue(standing());
    await expect(svc().add(SCHOOL, ACTOR, { sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', value: 12.5, holderName: 'X', sinceYear: 2024 })).rejects.toMatchObject({ response: { field: 'value', message: expect.stringMatching(/does not beat the standing record 12.30 s/) } });
    await svc().add(SCHOOL, ACTOR, { sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', value: 12.0, holderName: 'Y', sinceYear: 2024 });
    expect(txMock.sportsRecord.update).toHaveBeenCalledWith({ where: { id: 'r-old' }, data: { status: 'BROKEN', untilYear: 2024 } });
    expect(txMock.sportsRecord.create.mock.calls[1][0].data).toMatchObject({ status: 'STANDING', value: 12 });
    await expect(svc().add(SCHOOL, ACTOR, { sportKey: 'ath-100m', groupKey: 'sen', category: 'Boys', value: 12.0, holderName: 'Y', sinceYear: 2024, untilYear: 2020 })).rejects.toMatchObject({ response: { field: 'untilYear' } });
  });

  it('voiding the standing record restores the last broken one; voiding twice is refused', async () => {
    txMock.sportsRecord.findFirst.mockResolvedValueOnce(standing()).mockResolvedValueOnce({ id: 'r-prev' });
    expect(await svc().void(SCHOOL, ACTOR, 'r-old', 'Timing error')).toEqual({ restoredId: 'r-prev' });
    expect(txMock.sportsRecord.update.mock.calls[0][0]).toMatchObject({ where: { id: 'r-old' }, data: { status: 'VOID', note: 'Timing error' } });
    expect(txMock.sportsRecord.update.mock.calls[1][0]).toEqual({ where: { id: 'r-prev' }, data: { status: 'STANDING', untilYear: null } });
    txMock.sportsRecord.findFirst.mockResolvedValueOnce(standing({ status: 'VOID' }));
    await expect(svc().void(SCHOOL, ACTOR, 'r-old', 'x')).rejects.toMatchObject({ response: { message: 'This record is already void.' } });
  });
});
