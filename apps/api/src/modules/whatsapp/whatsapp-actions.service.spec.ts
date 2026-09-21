const db = {
  whatsAppInbound: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
  leaveApplication: { findUnique: jest.fn() },
  substitution: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  user: { findFirst: jest.fn() },
  teacher: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  timetableSlot: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  staffAttendance: { findMany: jest.fn().mockResolvedValue([]) },
  period: { findFirst: jest.fn().mockResolvedValue({ label: 'Period 3', order: 3, startTime: '10:15', endTime: '11:00' }) },
  classSection: { findFirst: jest.fn().mockResolvedValue({ name: '9-A' }) },
  school: { findFirst: jest.fn().mockResolvedValue({ name: 'Raffles' }) },
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));

import { ApiError } from '../../common/errors/api-error';
import { leavePayload, coverPayload, ackPayload } from '../../common/notifications/whatsapp/actions';
import { WhatsAppActionsService } from './whatsapp-actions.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LEAVE = '11111111-1111-1111-1111-111111111111';
const SUB = '22222222-2222-2222-2222-222222222222';
const T1 = '33333333-3333-3333-3333-333333333333';
const SECRET = 'shh';
const FROM = '919876543210';
const tap = (payload: string, id = 'wamid.tap') => ({ id, from: FROM, type: 'button', button: { payload, text: 'x' } });

describe('WhatsAppActionsService', () => {
  const env = { ...process.env };
  const leave = { approve: jest.fn(), reject: jest.fn(), assign: jest.fn() };
  const channel = { deliverWith: jest.fn().mockResolvedValue({ ok: true, code: null }) };
  const svc = () => new WhatsAppActionsService(leave as never, channel as never);
  // The reply body lives inside the send closure, so the spec reads it off the private text() seam.
  const textSpy = jest.spyOn(WhatsAppActionsService.prototype as unknown as { text: (...a: unknown[]) => Promise<unknown> }, 'text');
  const sentTexts = () => textSpy.mock.calls.map((c) => c[2] as string);
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.META_APP_SECRET = SECRET;
    db.whatsAppInbound.create.mockResolvedValue({});
    channel.deliverWith.mockResolvedValue({ ok: true, code: null });
    db.leaveApplication.findUnique.mockResolvedValue({ id: LEAVE, schoolId: SCHOOL, status: 'PENDING', teacherId: T1 });
    db.teacher.findFirst.mockResolvedValue({ firstName: 'Priya', lastName: 'Nair' });
    db.user.findFirst.mockResolvedValue({ id: 'admin-1' });
  });
  afterAll(() => { process.env = env; });

  it('a retried webhook (same Meta message id) is a no-op', async () => {
    db.whatsAppInbound.create.mockRejectedValueOnce(new Error('unique'));
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, SECRET)))).toBe('duplicate');
    expect(leave.approve).not.toHaveBeenCalled();
  });

  it('a tampered or foreign payload is recorded and never acted on', async () => {
    expect(await svc().handleInbound(tap('lv:a:' + LEAVE + ':000000000000'))).toBe('unknown-payload');
    expect(await svc().handleInbound({ id: 'w2', from: FROM, type: 'text', text: { body: 'hello' } })).toBe('text');
    expect(leave.approve).not.toHaveBeenCalled();
    expect(db.whatsAppInbound.create).toHaveBeenCalledTimes(2);
  });

  it('a number that is not a verified admin of THAT school is answered, and nothing changes', async () => {
    db.user.findFirst.mockResolvedValue(null);
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, SECRET)))).toBe('not-admin');
    expect(db.user.findFirst.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, phone: '+919876543210', phoneVerifiedAt: { not: null }, role: 'SCHOOL_ADMIN', isActive: true });
    expect(leave.approve).not.toHaveBeenCalled();
    expect(sentTexts()[0]).toMatch(/not a verified admin/);
  });

  it('Approve runs the SAME LeaveService.approve the console runs, then offers the cover list for the first gap', async () => {
    leave.approve.mockResolvedValue({ gaps: 2, gapIds: [SUB, 'gap-2'] });
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    db.teacher.findMany.mockResolvedValue([{ id: 'ta', firstName: 'Arun', lastName: 'Mehta' }, { id: 'tb', firstName: 'Kavya', lastName: 'Rao' }, { id: T1, firstName: 'Priya', lastName: 'Nair' }]);
    db.timetableSlot.findFirst.mockResolvedValue({ subjectId: 'maths', subject: { name: 'Mathematics' } });
    db.timetableSlot.findMany.mockResolvedValueOnce([{ teacherId: 'tb' }]) // busy that period
      .mockResolvedValueOnce([{ teacherId: 'ta' }]); // teaches the subject
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, SECRET)))).toBe('approved:2');
    expect(leave.approve).toHaveBeenCalledWith(SCHOOL, LEAVE, 'admin-1');
    expect(sentTexts()[0]).toMatch(/^Approved\. Priya Nair has been told\. 2 periods need cover/);
    const list = channel.deliverWith.mock.calls.find((c) => c[3] === 'interactive:list');
    expect(list).toBeDefined();
    expect(list![0]).toBe(SCHOOL);
  });

  it('Approve on an already-decided request says so and changes nothing', async () => {
    leave.approve.mockRejectedValue(new ApiError('LEAVE_NOT_PENDING', 'already', 409));
    db.leaveApplication.findUnique.mockResolvedValueOnce({ id: LEAVE, schoolId: SCHOOL, status: 'PENDING', teacherId: T1 }).mockResolvedValueOnce({ status: 'REJECTED', reviewedAt: new Date('2026-09-20T04:30:00Z') });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, SECRET)))).toBe('already-decided');
    expect(sentTexts()[0]).toMatch(/already rejected at/);
  });

  it('Reject runs LeaveService.reject and tells the admin', async () => {
    leave.reject.mockResolvedValue({});
    expect(await svc().handleInbound(tap(leavePayload('reject', LEAVE, SECRET)))).toBe('rejected');
    expect(leave.reject).toHaveBeenCalledWith(SCHOOL, LEAVE, 'admin-1');
  });

  it('a cover pick runs LeaveService.assign; a conflict re-offers the list; "skip" leaves it for the console', async () => {
    db.substitution.findUnique.mockResolvedValue({ id: SUB, schoolId: SCHOOL, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1, substituteTeacherId: null });
    leave.assign.mockResolvedValue({});
    db.substitution.findFirst.mockResolvedValue(null); // no next gap
    expect(await svc().handleInbound(tap(coverPayload(SUB, 'ta', SECRET)))).toBe('assigned:ta');
    expect(leave.assign).toHaveBeenCalledWith(SCHOOL, SUB, { substituteTeacherId: 'ta' });
    expect(sentTexts().at(-1)).toMatch(/Every period is covered/);

    jest.clearAllMocks();
    channel.deliverWith.mockResolvedValue({ ok: true, code: null });
    db.user.findFirst.mockResolvedValue({ id: 'admin-1' });
    db.substitution.findUnique.mockResolvedValue({ id: SUB, schoolId: SCHOOL, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1, substituteTeacherId: null });
    leave.assign.mockRejectedValue(new ApiError('TEACHER_CONFLICT', 'busy', 409));
    expect(await svc().handleInbound(tap(coverPayload(SUB, 'tb', SECRET), 'wamid.2'))).toBe('conflict');
    expect(sentTexts()[0]).toMatch(/no longer free/);

    expect(await svc().handleInbound(tap(coverPayload(SUB, 'skip', SECRET), 'wamid.3'))).toBe('skipped');
    expect(leave.assign).toHaveBeenCalledTimes(1);
  });

  it('when the 24-hour window has closed, the cover list falls back to the console template', async () => {
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    db.teacher.findMany.mockResolvedValue([{ id: 'ta', firstName: 'Arun', lastName: 'Mehta' }]);
    channel.deliverWith.mockImplementation(async (_s: string, _p: string, _k: string, label: string) => (label === 'interactive:list' ? { ok: false, code: 131047 } : { ok: true, code: null }));
    await svc().coverList(db as never, SCHOOL, '+919876543210', SUB);
    expect(channel.deliverWith.mock.calls.map((c) => c[3])).toEqual(['interactive:list', 'sckools_cover_pending']);
  });

  it('an acknowledgement is accepted only from the substitute themself', async () => {
    db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: 'ta' });
    db.teacher.findFirst.mockResolvedValue({ userId: 'u-ta' });
    db.user.findFirst.mockResolvedValueOnce(null);
    expect(await svc().handleInbound(tap(ackPayload(SUB, SECRET)))).toBe('ack-not-substitute');
    db.user.findFirst.mockResolvedValueOnce({ id: 'u-ta' });
    expect(await svc().handleInbound(tap(ackPayload(SUB, SECRET), 'wamid.4'))).toBe('acked');
  });
});
