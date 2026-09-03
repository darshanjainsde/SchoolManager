const txMock = {
  reportWindow: { findMany: jest.fn(), findFirst: jest.fn() },
  classSection: { findMany: jest.fn(), findFirst: jest.fn() },
  student: { findMany: jest.fn() },
  exam: { findMany: jest.fn() },
  result: { findMany: jest.fn(), count: jest.fn() },
  subject: { findMany: jest.fn(), findFirst: jest.fn() },
  teacher: { findMany: jest.fn() },
  pressIssue: { findMany: jest.fn() },
  resultNudge: { findMany: jest.fn(), createMany: jest.fn() },
  notification: { createMany: jest.fn() },
  attendance: { groupBy: jest.fn() },
  reportRemark: { findMany: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
jest.mock('@skoolos/db', () => ({
  ...jest.requireActual('@skoolos/db'),
  withTenant: (s: string, fn: (tx: unknown) => unknown) => withTenantMock(s, fn),
}));

import { ResultRoomService } from './result-room.service';
import { ReportCardService } from './report-card.service';
import type { AuditService } from '../../common/audit/audit.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WINDOW = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SECTION = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const SUBJECT = '99999999-9999-9999-9999-999999999999';
const TEACHER_USER = '11111111-1111-1111-1111-111111111111';
const ADMIN = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

const audit = { record: jest.fn() } as unknown as AuditService & { record: jest.Mock };
const reportCards = new ReportCardService();
const issueBatchSpy = jest.spyOn(reportCards, 'issueBatch').mockResolvedValue({ issued: [], skipped: [] });

function seedBoard(over: {
  results?: { examId: string; studentId: string; status: string; publishedAt: Date | null }[];
} = {}) {
  txMock.reportWindow.findMany.mockResolvedValue([{
    id: WINDOW, name: 'Term I', academicYearId: 'y1', academicYear: { name: '2026-27' },
    startDate: new Date('2026-06-01'), endDate: new Date('2026-09-30'), resultDay: new Date('2026-09-20'),
  }]);
  txMock.classSection.findMany.mockResolvedValue([
    { id: SECTION, name: 'B', grade: { name: 'VII', order: 7 } },
  ]);
  txMock.student.findMany.mockResolvedValue([
    { id: 's1', firstName: 'Aarav', lastName: 'Sharma', rollNo: '3', classSectionId: SECTION },
    { id: 's2', firstName: 'Meera', lastName: 'Rathore', rollNo: '7', classSectionId: SECTION },
  ]);
  txMock.exam.findMany.mockResolvedValue([
    { id: 'e1', classSectionId: SECTION, subjectId: SUBJECT, title: 'PT-1', createdById: TEACHER_USER },
  ]);
  txMock.result.findMany.mockResolvedValue(over.results ?? []);
  txMock.subject.findMany.mockResolvedValue([{ id: SUBJECT, name: 'Hindi' }]);
  txMock.teacher.findMany.mockResolvedValue([{ userId: TEACHER_USER, firstName: 'M.', lastName: 'Joshi' }]);
  txMock.pressIssue.findMany.mockResolvedValue([]);
  txMock.resultNudge.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  jest.clearAllMocks();
  withTenantMock.mockImplementation((_s: string, fn: (tx: unknown) => unknown) => fn(txMock));
});

describe('the board — three states, never two', () => {
  const svc = new ResultRoomService(reportCards, audit);

  it('a child with no Result row is MISSING, and is named', async () => {
    seedBoard({ results: [{ examId: 'e1', studentId: 's1', status: 'PRESENT', publishedAt: new Date() }] });
    const board = await svc.board(SCHOOL);
    const subj = board.classes[0]!.subjects[0]!;
    expect(subj.state).toBe('MISSING');
    expect(subj.entered).toBe(1);
    expect(subj.expected).toBe(2);
    expect(subj.missingStudents).toEqual(['Meera Rathore']);
    expect(subj.teacherName).toBe('M. Joshi');
    expect(board.classes[0]!.ready).toBe(false);
  });

  it('entered-everywhere but unpublished is its own amber state — not missing, not done', async () => {
    seedBoard({ results: [
      { examId: 'e1', studentId: 's1', status: 'PRESENT', publishedAt: null },
      { examId: 'e1', studentId: 's2', status: 'PRESENT', publishedAt: null },
    ] });
    const board = await svc.board(SCHOOL);
    expect(board.classes[0]!.subjects[0]!.state).toBe('ENTERED');
    expect(board.classes[0]!.ready).toBe(false);
  });

  it('AB and EX rows ARE data: the class turns ready, the absentee register fills', async () => {
    seedBoard({ results: [
      { examId: 'e1', studentId: 's1', status: 'AB', publishedAt: new Date() },
      { examId: 'e1', studentId: 's2', status: 'EX', publishedAt: new Date() },
    ] });
    const board = await svc.board(SCHOOL);
    const subj = board.classes[0]!.subjects[0]!;
    expect(subj.state).toBe('PUBLISHED');
    expect(subj.abCount).toBe(1);
    expect(subj.exCount).toBe(1);
    expect(board.classes[0]!.ready).toBe(true);
    expect(board.absentees).toEqual([{
      studentId: 's1', studentName: 'Aarav Sharma', classLabel: 'VII-B',
      subjectName: 'Hindi', examTitle: 'PT-1',
    }]);
  });

  it('a class with no exams is flagged, never guessed at', async () => {
    seedBoard();
    txMock.exam.findMany.mockResolvedValue([]);
    const board = await svc.board(SCHOOL);
    expect(board.classes[0]!.noExams).toBe(true);
    expect(board.classes[0]!.ready).toBe(false);
  });
});

describe('nudges — one tap, one bell, one log line', () => {
  const svc = new ResultRoomService(reportCards, audit);

  it('notifies each exam creator once, logs it, and carries the result day in the body', async () => {
    txMock.reportWindow.findFirst.mockResolvedValue({
      name: 'Term I', resultDay: new Date('2026-09-20'),
      startDate: new Date('2026-06-01'), endDate: new Date('2026-09-30'),
    });
    txMock.classSection.findFirst.mockResolvedValue({ name: 'B', grade: { name: 'VII' } });
    txMock.subject.findFirst.mockResolvedValue({ name: 'Hindi' });
    txMock.exam.findMany.mockResolvedValue([
      { createdById: TEACHER_USER }, { createdById: TEACHER_USER },
    ]);
    txMock.teacher.findMany.mockResolvedValue([{ userId: TEACHER_USER, firstName: 'M.', lastName: 'Joshi' }]);

    const out = await svc.nudge(SCHOOL,
      { windowId: WINDOW, classSectionId: SECTION, subjectId: SUBJECT, kind: 'ENTER' }, ADMIN);

    const bell = txMock.notification.createMany.mock.calls[0]![0].data;
    expect(bell).toHaveLength(1); // two exams, ONE teacher, one bell row
    expect(bell[0]).toMatchObject({ userId: TEACHER_USER, kind: 'RESULTS_DUE', title: 'Term I · Hindi · VII-B' });
    expect(bell[0].body).toContain('Result day is 20 Sept');
    expect(txMock.resultNudge.createMany.mock.calls[0]![0].data[0]).toMatchObject({
      windowId: WINDOW, teacherUserId: TEACHER_USER, kind: 'ENTER', sentById: ADMIN,
    });
    expect(out.notified).toEqual([{ teacherUserId: TEACHER_USER, teacherName: 'M. Joshi' }]);
  });

  it('a subject with no exams in the window has nobody to nudge — 404, not a silent success', async () => {
    txMock.reportWindow.findFirst.mockResolvedValue({
      name: 'Term I', resultDay: null, startDate: new Date('2026-06-01'), endDate: new Date('2026-09-30'),
    });
    txMock.classSection.findFirst.mockResolvedValue({ name: 'B', grade: { name: 'VII' } });
    txMock.subject.findFirst.mockResolvedValue({ name: 'Hindi' });
    txMock.exam.findMany.mockResolvedValue([]);
    await expect(svc.nudge(SCHOOL,
      { windowId: WINDOW, classSectionId: SECTION, subjectId: SUBJECT, kind: 'ENTER' }, ADMIN,
    )).rejects.toMatchObject({ status: 404 });
    expect(txMock.notification.createMany).not.toHaveBeenCalled();
  });
});

describe('the gate — ready generates, unready needs a signed reason', () => {
  const svc = new ResultRoomService(reportCards, audit);

  it('refuses an unready class without a note, naming what is pending', async () => {
    seedBoard({ results: [] });
    await expect(svc.generate(SCHOOL, { windowId: WINDOW, classSectionId: SECTION }, ADMIN))
      .rejects.toMatchObject({ status: 409, response: { code: 'RESULTS_NOT_READY' } });
    expect(issueBatchSpy).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('an override generates — and the reason lands in the audit log first', async () => {
    seedBoard({ results: [] });
    await svc.generate(SCHOOL,
      { windowId: WINDOW, classSectionId: SECTION, overrideNote: 'principal ordered — teacher on leave' }, ADMIN);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'press.generate_with_gaps',
      actorUserId: ADMIN,
      meta: expect.objectContaining({ note: 'principal ordered — teacher on leave' }),
    }));
    expect(issueBatchSpy).toHaveBeenCalledWith(SCHOOL, { windowId: WINDOW, classSectionId: SECTION }, ADMIN);
  });

  it('a ready class generates with no ceremony', async () => {
    seedBoard({ results: [
      { examId: 'e1', studentId: 's1', status: 'PRESENT', publishedAt: new Date() },
      { examId: 'e1', studentId: 's2', status: 'AB', publishedAt: new Date() },
    ] });
    await svc.generate(SCHOOL, { windowId: WINDOW, classSectionId: SECTION }, ADMIN);
    expect(audit.record).not.toHaveBeenCalled();
    expect(issueBatchSpy).toHaveBeenCalled();
  });
});
