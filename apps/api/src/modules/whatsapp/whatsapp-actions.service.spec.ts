const db = {
  whatsAppInbound: { create: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}), delete: jest.fn().mockResolvedValue({}) },
  leaveApplication: { findUnique: jest.fn() },
  substitution: { findUnique: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  teacher: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  timetableSlot: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  staffAttendance: { findMany: jest.fn().mockResolvedValue([]) },
  period: { findFirst: jest.fn().mockResolvedValue({ label: 'Period 3', order: 3, startTime: '10:15', endTime: '11:00' }) },
  classSection: { findFirst: jest.fn().mockResolvedValue({ name: '9-A' }) },
  school: { findFirst: jest.fn().mockResolvedValue({ name: 'Raffles' }) },
};
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));

import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { leavePayload, coverPayload, ackPayload, cantPayload, actionKeys, ACTION_TTL_MS } from '../../common/notifications/whatsapp/actions';
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
  const leave = { approve: jest.fn(), reject: jest.fn(), assign: jest.fn(), candidates: jest.fn(), acknowledge: jest.fn().mockResolvedValue({ acknowledgedAt: new Date() }), decline: jest.fn().mockResolvedValue({ declined: true }) };
  const channel = { deliverWith: jest.fn().mockResolvedValue({ ok: true, code: null }) };
  const identity = { actorFor: jest.fn() };
  const svc = () => new WhatsAppActionsService(leave as never, channel as never, identity as never);
  // The reply body lives inside the send closure, so the spec reads it off the private text() seam.
  const textSpy = jest.spyOn(WhatsAppActionsService.prototype as unknown as { text: (...a: unknown[]) => Promise<unknown> }, 'text');
  const sentTexts = () => textSpy.mock.calls.map((c) => c[2] as string);
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.WHATSAPP_ACTION_SECRET;
    delete process.env.WHATSAPP_ACTION_SECRET_PREV;
    process.env.META_APP_SECRET = SECRET;
    db.whatsAppInbound.create.mockResolvedValue({});
    channel.deliverWith.mockResolvedValue({ ok: true, code: null });
    db.leaveApplication.findUnique.mockResolvedValue({ id: LEAVE, schoolId: SCHOOL, status: 'PENDING', teacherId: T1 });
    db.teacher.findFirst.mockResolvedValue({ firstName: 'Priya', lastName: 'Nair' });
    identity.actorFor.mockResolvedValue({ ok: true, profile: { userId: 'admin-1', kind: 'ADMIN', role: 'SCHOOL_ADMIN' } });
    leave.candidates.mockResolvedValue([]);
  });
  afterAll(() => { process.env = env; });

  /** Runs the real send closure so the list Meta would receive can be read off sendList. */
  function captureList() {
    const spy = jest.spyOn(require('../../common/notifications/whatsapp/graph.client'), 'sendList');
    channel.deliverWith.mockImplementation(async (_s: string, _p: string, _k: string, _l: string, fn: (c: unknown, p: null, f: unknown) => Promise<unknown>) => {
      await fn({ token: 't', phoneNumberId: '1', wabaId: null, graphVersion: 'v21.0' }, null, jest.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{ id: 'w' }] }) }));
      return { ok: true, code: null };
    });
    return {
      list: () => spy.mock.calls[0]?.[2] as { body: string; footer?: string; rows: { id: string; title: string; description?: string }[] } | undefined,
      restore: () => spy.mockRestore(),
    };
  }
  const someone = (i: number) => ({ id: `t${i}`, name: `Teacher ${i}`, teachesSubject: false, coversThatDay: 0 });

  it('a retried webhook (same Meta message id) is a no-op', async () => {
    db.whatsAppInbound.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }));
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('duplicate');
    expect(leave.approve).not.toHaveBeenCalled();
  });

  it('a database failure is NOT a duplicate — it throws so Meta retries, and nothing is approved', async () => {
    db.whatsAppInbound.create.mockRejectedValueOnce(new Error('connection reset'));
    await expect(svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.2'))).rejects.toThrow('connection reset');
    expect(leave.approve).not.toHaveBeenCalled();
  });

  it('the tapping number is normalised like every stored number', async () => {
    leave.approve.mockResolvedValue({ gaps: 0, gapIds: [] });
    await svc().handleInbound({ ...tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.3'), from: '09876543210' });
    expect(db.whatsAppInbound.create).toHaveBeenCalledWith({ data: expect.objectContaining({ phone: '+919876543210' }) });
  });

  it('a tampered or foreign payload is recorded and never acted on', async () => {
    expect(await svc().handleInbound(tap('lv:a:' + LEAVE + ':000000000000'))).toBe('unknown-payload');
    expect(await svc().handleInbound({ id: 'w2', from: FROM, type: 'text', text: { body: 'hello' } })).toBe('text');
    expect(leave.approve).not.toHaveBeenCalled();
    expect(db.whatsAppInbound.create).toHaveBeenCalledTimes(2);
  });

  it('an expired button replies "This button has expired" and records expired without touching LeaveService', async () => {
    const old = leavePayload('approve', LEAVE, actionKeys(), Date.now() - ACTION_TTL_MS - 3_600_000);
    expect(await svc().handleInbound(tap(old, 'wamid.old'))).toBe('expired');
    expect(sentTexts()).toEqual([expect.stringContaining('This button has expired')]);
    expect(leave.approve).not.toHaveBeenCalled();
    expect(leave.reject).not.toHaveBeenCalled();
    expect(db.whatsAppInbound.update).toHaveBeenCalledWith({ where: { id: 'wamid.old' }, data: { result: 'expired', schoolId: SCHOOL } });
  });

  it('an expired acknowledgement is recorded as expired and answered with NOTHING — a substitute has nothing to decide in the console', async () => {
    db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL });
    const old = ackPayload(SUB, actionKeys(), Date.now() - ACTION_TTL_MS - 3_600_000);
    expect(await svc().handleInbound(tap(old, 'wamid.oldack'))).toBe('expired');
    expect(sentTexts()).toEqual([]);
    expect(channel.deliverWith).not.toHaveBeenCalled();
    expect(db.whatsAppInbound.update).toHaveBeenCalledWith({ where: { id: 'wamid.oldack' }, data: { result: 'expired', schoolId: SCHOOL } });
  });

  it('a number that cannot run the leave desk at THAT school is told so — the school named, the request not', async () => {
    identity.actorFor.mockResolvedValue({ ok: false, why: 'NOT_ALLOWED' });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('not-allowed');
    expect(identity.actorFor).toHaveBeenCalledWith('+919876543210', SCHOOL, { kind: 'LEAVE_DESK' });
    expect(leave.approve).not.toHaveBeenCalled();
    expect(sentTexts()[0]).toBe('This number cannot do that at Raffles. Decide in the console.');
  });

  it('two people on one number: nothing changes, and the reply says why', async () => {
    identity.actorFor.mockResolvedValue({ ok: false, why: 'AMBIGUOUS' });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('ambiguous');
    expect(leave.approve).not.toHaveBeenCalled();
    expect(sentTexts()[0]).toBe('This number belongs to more than one person at Raffles, so nothing was done. Please decide in the console.');
  });

  it('the accounts officer approves on WhatsApp exactly as on the web — as herself', async () => {
    identity.actorFor.mockResolvedValue({ ok: true, profile: { userId: 'u-accounts', kind: 'STAFF', role: 'STAFF' } });
    leave.approve.mockResolvedValue({ gaps: 0, gapIds: [] });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('approved');
    expect(leave.approve).toHaveBeenCalledWith(SCHOOL, LEAVE, 'u-accounts');
  });

  it('a cover pick is a leave-desk act too', async () => {
    identity.actorFor.mockResolvedValue({ ok: false, why: 'NOT_ALLOWED' });
    db.substitution.findUnique.mockResolvedValue({ id: SUB, schoolId: SCHOOL, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1, substituteTeacherId: null });
    expect(await svc().handleInbound(tap(coverPayload(SUB, 'ta', actionKeys())))).toBe('not-allowed');
    expect(leave.assign).not.toHaveBeenCalled();
  });

  it('Approve runs the SAME LeaveService.approve the console runs, then offers the free teachers LeaveService names', async () => {
    leave.approve.mockResolvedValue({ gaps: 2, gapIds: [SUB, 'gap-2'] });
    leave.candidates.mockResolvedValue([
      { id: 'ta', name: 'Arun Mehta', teachesSubject: true, coversThatDay: 0 },
      { id: 'tb', name: 'Kavya Rao', teachesSubject: false, coversThatDay: 1 },
    ]);
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    db.timetableSlot.findFirst.mockResolvedValue({ subject: { name: 'Mathematics' } });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('approved:2');
    expect(leave.approve).toHaveBeenCalledWith(SCHOOL, LEAVE, 'admin-1');
    expect(sentTexts()[0]).toMatch(/^Approved\. Priya Nair has been told\. 2 periods need cover/);
    expect(leave.candidates).toHaveBeenCalledWith(SCHOOL, SUB);
    // The list computes nothing itself: no timetable or attendance sweep of its own.
    expect(db.timetableSlot.findMany).not.toHaveBeenCalled();
    expect(db.staffAttendance.findMany).not.toHaveBeenCalled();
    expect(db.teacher.findMany).not.toHaveBeenCalled();
    const list = channel.deliverWith.mock.calls.find((c) => c[3] === 'interactive:list');
    expect(list).toBeDefined();
    expect(list![0]).toBe(SCHOOL);
  });

  it('the list shows who teaches the subject and how loaded the others are, in LeaveService\'s order, and names the school', async () => {
    leave.candidates.mockResolvedValue([
      { id: 'ta', name: 'Arun Mehta', teachesSubject: true, coversThatDay: 0 },
      { id: 'tb', name: 'Kavya Rao', teachesSubject: false, coversThatDay: 1 },
      { id: 'tc', name: 'Mohan Lal', teachesSubject: false, coversThatDay: 2 },
      { id: 'td', name: 'Anil Kumar', teachesSubject: false, coversThatDay: 0 },
    ]);
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    db.timetableSlot.findFirst.mockResolvedValue({ subject: { name: 'Mathematics' } });
    const cap = captureList();
    await svc().coverList(db as never, SCHOOL, '+919876543210', SUB);
    const sent = cap.list()!;
    expect(sent.rows.map((r) => [r.title, r.description])).toEqual([
      ['Arun Mehta', 'teaches Mathematics'],
      ['Kavya Rao', '1 cover already that day'],
      ['Mohan Lal', '2 covers already that day'],
      ['Anil Kumar', 'free this period'],
      ['Decide in the console', 'leave this one for later'],
    ]);
    expect(sent.body).toBe('Raffles: 9-A · Mathematics\nMon 21 Sep, Period 3 (10:15–11:00)');
    expect(sent.footer).toBe('4 free');
    // Each row is a signed pick of THAT teacher for THIS gap.
    const { parseAction } = require('../../common/notifications/whatsapp/actions');
    expect(sent.rows.map((r) => parseAction(r.id, actionKeys()).action)).toEqual([
      { kind: 'cover', substitutionId: SUB, teacherId: 'ta' },
      { kind: 'cover', substitutionId: SUB, teacherId: 'tb' },
      { kind: 'cover', substitutionId: SUB, teacherId: 'tc' },
      { kind: 'cover', substitutionId: SUB, teacherId: 'td' },
      { kind: 'cover', substitutionId: SUB, teacherId: 'skip' },
    ]);
    cap.restore();
  });

  it('the subject is read off the slot LIVE that date, not any slot that was ever open', async () => {
    leave.candidates.mockResolvedValue([someone(1)]);
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    await svc().coverList(db as never, SCHOOL, '+919876543210', SUB);
    const asOf = new Date('2026-09-21T00:00:00+05:30');
    expect(db.timetableSlot.findFirst.mock.calls[0][0].where).toEqual({
      schoolId: SCHOOL, classSectionId: 'cs', periodId: 'p3', dayOfWeek: 1,
      effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
    });
  });

  it('more than nine free teachers: nine rows and the way out (Meta\'s ten), ids within 200 characters, and "and N more in the console"', async () => {
    leave.candidates.mockResolvedValue(Array.from({ length: 13 }, (_, i) => someone(i + 1)));
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    const cap = captureList();
    await svc().coverList(db as never, SCHOOL, '+919876543210', SUB);
    const sent = cap.list()!;
    expect(sent.rows).toHaveLength(10);
    expect(sent.rows.slice(0, 9).map((r) => r.title)).toEqual(Array.from({ length: 9 }, (_, i) => `Teacher ${i + 1}`));
    expect(sent.rows[9].title).toBe('Decide in the console');
    for (const r of sent.rows) expect(r.id.length).toBeLessThanOrEqual(200);
    expect(sent.body).toMatch(/9 shown here, and 4 more in the console\.$/);
    expect(sent.footer).toBe('13 free');
    cap.restore();
  });

  it('exactly nine free: all nine shown, no "more" line', async () => {
    leave.candidates.mockResolvedValue(Array.from({ length: 9 }, (_, i) => someone(i + 1)));
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    const cap = captureList();
    await svc().coverList(db as never, SCHOOL, '+919876543210', SUB);
    expect(cap.list()!.rows).toHaveLength(10);
    expect(cap.list()!.body).not.toMatch(/more in the console/);
    cap.restore();
  });

  it('nobody free: no list, and a reply in plain words that names the school', async () => {
    leave.candidates.mockResolvedValue([]);
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    await svc().coverList(db as never, SCHOOL, '+919876543210', SUB);
    expect(channel.deliverWith.mock.calls.map((c) => c[3])).toEqual(['text']);
    expect(sentTexts()).toEqual(['Raffles: nobody is free to cover 9-A on Mon 21 Sep, Period 3 (10:15–11:00). Every teacher is teaching, covering or on leave then. Please decide in the console.']);
  });

  it('Approve with nobody free still approves, and says nobody is free', async () => {
    leave.approve.mockResolvedValue({ gaps: 1, gapIds: [SUB] });
    leave.candidates.mockResolvedValue([]);
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.none'))).toBe('approved:1');
    expect(sentTexts()[1]).toMatch(/^Raffles: nobody is free to cover 9-A/);
  });

  it('a gap removed between the approve and the list (a cancel in the console) is answered, not retried', async () => {
    leave.approve.mockResolvedValue({ gaps: 1, gapIds: [SUB] });
    leave.candidates.mockRejectedValue(new NotFoundException('Substitution not found'));
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.gone'))).toBe('approved:1');
    expect(sentTexts()[1]).toBe('Raffles: that period no longer needs cover. Nothing to pick.');
    expect(db.whatsAppInbound.delete).not.toHaveBeenCalled();
  });

  it('an infrastructure failure while listing the free teachers rethrows, so Meta retries', async () => {
    leave.approve.mockResolvedValue({ gaps: 1, gapIds: [SUB] });
    leave.candidates.mockRejectedValue(new Error('pool timeout'));
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    await expect(svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.listinfra'))).rejects.toThrow('pool timeout');
    expect(db.whatsAppInbound.delete).toHaveBeenCalledWith({ where: { id: 'wamid.listinfra' } });
  });

  it('an infrastructure failure inside the action frees the inbound row and rethrows, so Meta retries and the tap is not lost', async () => {
    leave.approve.mockRejectedValueOnce(new Error('pool timeout'));
    await expect(svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.infra'))).rejects.toThrow('pool timeout');
    expect(db.whatsAppInbound.delete).toHaveBeenCalledWith({ where: { id: 'wamid.infra' } });
    expect(db.whatsAppInbound.update).not.toHaveBeenCalled();
  });

  it('an ApiError other than already-decided is a business answer: recorded as error:, row kept', async () => {
    leave.approve.mockRejectedValueOnce(new ApiError('VALIDATION', 'nope', 400));
    const r = await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.biz'));
    expect(r).toMatch(/^error:/);
    expect(db.whatsAppInbound.delete).not.toHaveBeenCalled();
    expect(db.whatsAppInbound.update).toHaveBeenCalledWith({ where: { id: 'wamid.biz' }, data: expect.objectContaining({ result: expect.stringMatching(/^error:/) }) });
  });

  it("a Nest 4xx (LeaveService's NotFoundException) is a business answer: recorded as error:, row kept", async () => {
    leave.approve.mockRejectedValueOnce(new NotFoundException('Leave application not found'));
    const r = await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.nf'));
    expect(r).toMatch(/^error:/);
    expect(db.whatsAppInbound.delete).not.toHaveBeenCalled();
  });

  it('an HttpException with status >= 500 is infrastructure: row freed, rethrown', async () => {
    leave.approve.mockRejectedValueOnce(new ServiceUnavailableException());
    await expect(svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.503'))).rejects.toThrow();
    expect(db.whatsAppInbound.delete).toHaveBeenCalledWith({ where: { id: 'wamid.503' } });
  });

  it('a retry of the tap after an infrastructure failure approves exactly once', async () => {
    leave.approve.mockRejectedValueOnce(new Error('pool timeout')).mockResolvedValueOnce({ gaps: 0, gapIds: [] });
    const t = tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.retry');
    await expect(svc().handleInbound(t)).rejects.toThrow('pool timeout');
    expect(await svc().handleInbound(t)).toBe('approved');
    expect(db.whatsAppInbound.create).toHaveBeenCalledTimes(2);
    expect(leave.approve).toHaveBeenCalledTimes(2);
    expect(db.whatsAppInbound.update).toHaveBeenCalledTimes(1); // only the success is recorded
  });

  it('Approve on an already-decided request says who decided, and changes nothing', async () => {
    leave.approve.mockRejectedValue(new ApiError('LEAVE_NOT_PENDING', 'Already rejected by Darshan Jain at 10:00 am. Nothing changed.', 409));
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys())))).toBe('already-decided');
    // The school, then the service's own sentence — never the request row.
    expect(sentTexts()).toEqual(['Raffles: Already rejected by Darshan Jain at 10:00 am. Nothing changed.']);
    expect(db.whatsAppInbound.delete).not.toHaveBeenCalled();
    expect(db.whatsAppInbound.update).toHaveBeenCalledWith({ where: { id: 'wamid.tap' }, data: { result: 'already-decided', schoolId: SCHOOL } });
  });

  it('Reject on an already-decided request is answered the same way', async () => {
    leave.reject.mockRejectedValue(new ApiError('LEAVE_NOT_PENDING', 'Already approved by Asha Rao on Mon 5 Oct at 4:10 pm. Nothing changed.', 409));
    expect(await svc().handleInbound(tap(leavePayload('reject', LEAVE, actionKeys()), 'wamid.rej'))).toBe('already-decided');
    expect(sentTexts()).toEqual(['Raffles: Already approved by Asha Rao on Mon 5 Oct at 4:10 pm. Nothing changed.']);
  });

  it('an officer tapping Approve on her own leave is told no, and nothing changes', async () => {
    leave.approve.mockRejectedValue(new ApiError('LEAVE_OWN_DECISION', 'You cannot decide your own leave. Another admin or the accounts officer has to.', 403));
    expect(await svc().handleInbound(tap(leavePayload('approve', LEAVE, actionKeys()), 'wamid.own'))).toBe('own-leave');
    expect(sentTexts()[0]).toMatch(/cannot decide your own leave/);
    expect(sentTexts()).toEqual(['Raffles: You cannot decide your own leave. Another admin or the accounts officer has to.']);
    expect(leave.approve).toHaveBeenCalledWith(SCHOOL, LEAVE, 'admin-1');
    expect(db.whatsAppInbound.delete).not.toHaveBeenCalled();
    expect(db.whatsAppInbound.update).toHaveBeenCalledWith({ where: { id: 'wamid.own' }, data: { result: 'own-leave', schoolId: SCHOOL } });
  });

  it('… and on Reject too', async () => {
    leave.reject.mockRejectedValue(new ApiError('LEAVE_OWN_DECISION', 'You cannot decide your own leave. Another admin or the accounts officer has to.', 403));
    expect(await svc().handleInbound(tap(leavePayload('reject', LEAVE, actionKeys()), 'wamid.own2'))).toBe('own-leave');
    expect(sentTexts()).toEqual(['Raffles: You cannot decide your own leave. Another admin or the accounts officer has to.']);
  });

  it('Reject runs LeaveService.reject and tells the admin', async () => {
    leave.reject.mockResolvedValue({});
    expect(await svc().handleInbound(tap(leavePayload('reject', LEAVE, actionKeys())))).toBe('rejected');
    expect(leave.reject).toHaveBeenCalledWith(SCHOOL, LEAVE, 'admin-1');
  });

  it('a cover pick runs LeaveService.assign; a conflict re-offers the list; "skip" leaves it for the console', async () => {
    db.substitution.findUnique.mockResolvedValue({ id: SUB, schoolId: SCHOOL, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1, substituteTeacherId: null });
    leave.assign.mockResolvedValue({});
    db.substitution.findFirst.mockResolvedValue(null); // no next gap
    expect(await svc().handleInbound(tap(coverPayload(SUB, 'ta', actionKeys())))).toBe('assigned:ta');
    expect(leave.assign).toHaveBeenCalledWith(SCHOOL, SUB, { substituteTeacherId: 'ta' });
    expect(sentTexts().at(-1)).toMatch(/Every period is covered/);

    jest.clearAllMocks();
    channel.deliverWith.mockResolvedValue({ ok: true, code: null });
    identity.actorFor.mockResolvedValue({ ok: true, profile: { userId: 'admin-1', kind: 'ADMIN', role: 'SCHOOL_ADMIN' } });
    db.substitution.findUnique.mockResolvedValue({ id: SUB, schoolId: SCHOOL, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1, substituteTeacherId: null });
    leave.assign.mockRejectedValue(new ApiError('TEACHER_CONFLICT', 'busy', 409));
    leave.candidates.mockResolvedValue([{ id: 'ta', name: 'Arun Mehta', teachesSubject: false, coversThatDay: 0 }]);
    expect(await svc().handleInbound(tap(coverPayload(SUB, 'tb', actionKeys()), 'wamid.2'))).toBe('conflict');
    expect(sentTexts()[0]).toMatch(/no longer free/);
    // The re-offered list is LeaveService's own answer for that gap.
    expect(leave.candidates).toHaveBeenCalledWith(SCHOOL, SUB);
    expect(channel.deliverWith.mock.calls.map((c) => c[3])).toEqual(['text', 'interactive:list']);

    expect(await svc().handleInbound(tap(coverPayload(SUB, 'skip', actionKeys()), 'wamid.3'))).toBe('skipped');
    expect(leave.assign).toHaveBeenCalledTimes(1);
  });

  it('a WhatsApp pick that loses to the console (assign is compare-and-set) says the period is covered and moves on — no list', async () => {
    channel.deliverWith.mockResolvedValue({ ok: true, code: null });
    identity.actorFor.mockResolvedValue({ ok: true, profile: { userId: 'admin-1', kind: 'ADMIN', role: 'SCHOOL_ADMIN' } });
    const gap = { id: SUB, schoolId: SCHOOL, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1, substituteTeacherId: null };
    db.substitution.findUnique.mockResolvedValueOnce(gap).mockResolvedValueOnce({ substituteTeacherId: 'tc' });
    db.substitution.findFirst.mockResolvedValue(null);
    leave.assign.mockRejectedValue(new ApiError('TEACHER_CONFLICT', 'Someone changed this cover a moment ago', 409));
    expect(await svc().handleInbound(tap(coverPayload(SUB, 'tb', actionKeys()), 'wamid.race'))).toBe('already-covered');
    expect(sentTexts()).toEqual(['Someone else covered that period a moment ago. Moving on.', 'Every period is covered. Thank you.']);
    expect(leave.candidates).not.toHaveBeenCalled();
  });

  it('when the 24-hour window has closed, the cover list falls back to the console template', async () => {
    db.substitution.findUnique.mockResolvedValue({ id: SUB, date: new Date('2026-09-21'), periodId: 'p3', classSectionId: 'cs', originalTeacherId: T1 });
    leave.candidates.mockResolvedValue([{ id: 'ta', name: 'Arun Mehta', teachesSubject: false, coversThatDay: 0 }]);
    channel.deliverWith.mockImplementation(async (_s: string, _p: string, _k: string, label: string) => (label === 'interactive:list' ? { ok: false, code: 131047 } : { ok: true, code: null }));
    await svc().coverList(db as never, SCHOOL, '+919876543210', SUB);
    expect(channel.deliverWith.mock.calls.map((c) => c[3])).toEqual(['interactive:list', 'sckools_cover_pending']);
  });

  it('an acknowledgement is accepted only from the substitute themself, and anyone else is answered with nothing', async () => {
    db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: 'ta' });
    identity.actorFor.mockResolvedValueOnce({ ok: false, why: 'NOT_ALLOWED' });
    expect(await svc().handleInbound(tap(ackPayload(SUB, actionKeys())))).toBe('ack-not-substitute');
    expect(sentTexts()).toEqual([]);
    identity.actorFor.mockResolvedValueOnce({ ok: true, profile: { userId: 'u-ta', kind: 'TEACHER', role: 'TEACHER' } });
    expect(await svc().handleInbound(tap(ackPayload(SUB, actionKeys()), 'wamid.4'))).toBe('acked');
    expect(identity.actorFor).toHaveBeenLastCalledWith('+919876543210', SCHOOL, { kind: 'SUBSTITUTE', substitutionId: SUB });
  });

  describe('Got it and Can\'t', () => {
    const TA = 'ta';
    const asSubstitute = () => identity.actorFor.mockResolvedValueOnce({ ok: true, profile: { userId: 'u-ta', kind: 'TEACHER', role: 'TEACHER' } });
    beforeEach(() => {
      leave.acknowledge.mockResolvedValue({ acknowledgedAt: new Date() });
      leave.decline.mockResolvedValue({ declined: true });
    });

    it('Got it records the acknowledgement through LeaveService, as the substitute, and names the school', async () => {
      db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: TA });
      asSubstitute();
      expect(await svc().handleInbound(tap(ackPayload(SUB, actionKeys()), 'wamid.ack'))).toBe('acked');
      expect(leave.acknowledge).toHaveBeenCalledWith(SCHOOL, SUB, 'u-ta');
      expect(sentTexts()).toEqual(['Raffles: noted — thank you. The office can see you have it.']);
    });

    it('Got it that loses to a reassignment between the two reads is recorded (4xx) and answered with nothing', async () => {
      db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: TA });
      asSubstitute();
      leave.acknowledge.mockRejectedValueOnce(new ApiError('NOT_THE_SUBSTITUTE', 'This cover is no longer yours.', 409));
      expect(await svc().handleInbound(tap(ackPayload(SUB, actionKeys()), 'wamid.ack2'))).toMatch(/^error: /);
      expect(sentTexts()).toEqual([]);
      expect(db.whatsAppInbound.delete).not.toHaveBeenCalled();
    });

    it("Can't clears the cover through LeaveService and says the office will find someone, naming the school", async () => {
      db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: TA });
      asSubstitute();
      expect(await svc().handleInbound(tap(cantPayload(SUB, TA, actionKeys()), 'wamid.cant'))).toBe('declined');
      expect(identity.actorFor).toHaveBeenLastCalledWith('+919876543210', SCHOOL, { kind: 'TEACHER', teacherId: TA });
      expect(leave.decline).toHaveBeenCalledWith(SCHOOL, SUB, 'u-ta');
      expect(sentTexts()).toEqual(['Raffles: okay — you are off this cover. The office has been told and will find someone else.']);
    });

    it("Can't from anyone but the teacher the card was sent to is recorded and not answered", async () => {
      db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: TA });
      identity.actorFor.mockResolvedValueOnce({ ok: false, why: 'NOT_ALLOWED' });
      expect(await svc().handleInbound(tap(cantPayload(SUB, TA, actionKeys()), 'wamid.cant2'))).toBe('cant-not-substitute');
      expect(leave.decline).not.toHaveBeenCalled();
      expect(sentTexts()).toEqual([]);
      expect(db.whatsAppInbound.update).toHaveBeenCalledWith({ where: { id: 'wamid.cant2' }, data: { result: 'cant-not-substitute', schoolId: SCHOOL } });
    });

    it("Can't after the desk gave the period to someone else: nothing changes, and the tapper is told it already changed", async () => {
      db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: 'tb' });
      asSubstitute();
      expect(await svc().handleInbound(tap(cantPayload(SUB, TA, actionKeys()), 'wamid.cant3'))).toBe('cover-moved');
      expect(leave.decline).not.toHaveBeenCalled();
      expect(sentTexts()).toEqual(['Raffles: this cover has already changed, so nothing was done. Open the Sckools app to see your day as it stands.']);
    });

    it("Can't racing a reassignment (LeaveService's compare-and-set refuses) says the same and changes nothing", async () => {
      db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: TA });
      asSubstitute();
      leave.decline.mockRejectedValueOnce(new ApiError('NOT_THE_SUBSTITUTE', 'This cover is no longer yours, so nothing changed.', 409));
      expect(await svc().handleInbound(tap(cantPayload(SUB, TA, actionKeys()), 'wamid.cant4'))).toBe('cover-moved');
      expect(sentTexts()).toEqual(['Raffles: this cover has already changed, so nothing was done. Open the Sckools app to see your day as it stands.']);
    });

    it("Can't on a gap the desk cleared, or one called off with its leave, is answered to that teacher — the school found from them", async () => {
      db.substitution.findUnique.mockResolvedValue(null);
      db.teacher.findUnique.mockResolvedValue({ schoolId: SCHOOL });
      asSubstitute();
      expect(await svc().handleInbound(tap(cantPayload(SUB, TA, actionKeys()), 'wamid.cant5'))).toBe('cover-moved');
      expect(db.teacher.findUnique).toHaveBeenCalledWith({ where: { id: TA }, select: { schoolId: true } });
      expect(identity.actorFor).toHaveBeenLastCalledWith('+919876543210', SCHOOL, { kind: 'TEACHER', teacherId: TA });
      expect(leave.decline).not.toHaveBeenCalled();
    });

    it("an old card's Can't (no teacher on it) acts for whoever covers it now", async () => {
      db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: TA });
      asSubstitute();
      expect(await svc().handleInbound(tap(cantPayload(SUB, null, actionKeys()), 'wamid.cant6'))).toBe('declined');
      expect(identity.actorFor).toHaveBeenLastCalledWith('+919876543210', SCHOOL, { kind: 'TEACHER', teacherId: TA });
    });

    it("an infrastructure failure inside decline is rethrown so Meta retries, and the tap is freed", async () => {
      db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL, substituteTeacherId: TA });
      asSubstitute();
      leave.decline.mockRejectedValueOnce(new Error('pool timeout'));
      await expect(svc().handleInbound(tap(cantPayload(SUB, TA, actionKeys()), 'wamid.cant7'))).rejects.toThrow('pool timeout');
      expect(db.whatsAppInbound.delete).toHaveBeenCalledWith({ where: { id: 'wamid.cant7' } });
    });

    it("an expired Can't is recorded and not answered, like an expired Got it", async () => {
      db.substitution.findUnique.mockResolvedValue({ schoolId: SCHOOL });
      const old = cantPayload(SUB, TA, actionKeys(), Date.now() - ACTION_TTL_MS - 3_600_000);
      expect(await svc().handleInbound(tap(old, 'wamid.oldcant'))).toBe('expired');
      expect(sentTexts()).toEqual([]);
      expect(leave.decline).not.toHaveBeenCalled();
    });
  });
});
