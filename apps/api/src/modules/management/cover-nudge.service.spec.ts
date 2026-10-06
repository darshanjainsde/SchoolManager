const platform = { substitution: { groupBy: jest.fn() } };
const tx = {
  $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: '' }]),
  notificationOutbox: { findFirst: jest.fn(), create: jest.fn() },
  notification: { create: jest.fn() },
  substitution: { count: jest.fn() },
  school: { findFirst: jest.fn(), findUnique: jest.fn() },
  holiday: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  staff: { findMany: jest.fn() },
};
const withTenantMock = jest.fn((_s: string, fn: (t: unknown) => unknown) => fn(tx));
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => platform, withTenant: (s: string, fn: (t: unknown) => unknown) => withTenantMock(s, fn) }));
jest.mock('../../common/notifications/outbox-signal', () => ({ requestOutboxDrain: jest.fn() }));

import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CronSecretGuard } from '../../common/auth/cron-secret.guard';
import { requestOutboxDrain } from '../../common/notifications/outbox-signal';
import { CoverNudgeController } from './cover-nudge.controller';
import { CoverNudgeService } from './cover-nudge.service';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date('2026-10-12T12:30:00Z'); // 18:00 IST, Monday

describe("CoverNudgeService — tomorrow's empty classes, at 18:00 IST", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    withTenantMock.mockImplementation((_s: string, fn: (t: unknown) => unknown) => fn(tx));
    tx.$queryRaw.mockResolvedValue([{ pg_advisory_xact_lock: '' }]);
    tx.notificationOutbox.findFirst.mockResolvedValue(null);
    tx.substitution.count.mockResolvedValue(4);
    tx.school.findFirst.mockResolvedValue({ name: 'Raffles' });
    tx.school.findUnique.mockResolvedValue({ workingDays: [1, 2, 3, 4, 5, 6] });
    tx.holiday.findMany.mockResolvedValue([]);
    tx.user.findMany.mockResolvedValue([{ id: 'u-head', email: 'head@x' }]);
    tx.staff.findMany.mockResolvedValue([]);
    platform.substitution.groupBy.mockResolvedValue([{ schoolId: A }]);
  });

  it("one COVER_UNFILLED per school to the desk, counting tomorrow's uncovered gaps inside the tenant", async () => {
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 1, nudged: 1 });
    // The platform client only FINDS the schools.
    expect(platform.substitution.groupBy).toHaveBeenCalledWith({ by: ['schoolId'], where: { date: new Date('2026-10-13'), substituteTeacherId: null } });
    expect(withTenantMock).toHaveBeenCalledWith(A, expect.any(Function));
    expect(tx.substitution.count).toHaveBeenCalledWith({ where: { schoolId: A, date: new Date('2026-10-13'), substituteTeacherId: null } });
    expect(tx.notificationOutbox.create).toHaveBeenCalledWith({
      data: { schoolId: A, kind: 'COVER_UNFILLED', targetUserId: 'u-head', payload: { schoolName: 'Raffles', gaps: 4, forDate: '2026-10-13', forWhen: 'tomorrow, Tue 13 Oct 2026', note: null, nudgeFor: '2026-10-13' } },
      select: { id: true },
    });
    expect(tx.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u-head', title: '4 classes have no teacher tomorrow', body: 'Tue 13 Oct 2026' }) });
    expect(requestOutboxDrain).toHaveBeenCalledTimes(1);
  });

  it('fired twice (Vercel can), the desk still gets one nudge: the second run finds the first, under the lock', async () => {
    tx.notificationOutbox.findFirst.mockResolvedValue({ id: 'already' });
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 1, nudged: 0 });
    expect(tx.notificationOutbox.findFirst).toHaveBeenCalledWith({
      where: { schoolId: A, kind: 'COVER_UNFILLED', createdAt: { gte: new Date(NOW.getTime() - 12 * 3_600_000) }, payload: { path: ['nudgeFor'], equals: '2026-10-13' } },
      select: { id: true },
    });
    expect(tx.notificationOutbox.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(requestOutboxDrain).not.toHaveBeenCalled();
  });

  it('the key is (school, date): the advisory lock is taken BEFORE the check, so two overlapping runs cannot both write', async () => {
    await new CoverNudgeService().run(NOW);
    const [strings, ...values] = tx.$queryRaw.mock.calls[0];
    expect(strings.join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?), hashtext(?))::text');
    expect(values).toEqual([A, 'cover-nudge:2026-10-13']);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.notificationOutbox.findFirst.mock.invocationCallOrder[0]);
  });

  it("two runs, one after the other, end with ONE nudge (the first's row is what the second finds)", async () => {
    const written: unknown[] = [];
    tx.notificationOutbox.create.mockImplementation(async ({ data }: { data: unknown }) => { written.push(data); return { id: 'n1' }; });
    tx.notificationOutbox.findFirst.mockImplementation(async () => (written.length ? { id: 'n1' } : null));
    const svc = new CoverNudgeService();
    expect(await svc.run(NOW)).toEqual({ schools: 1, nudged: 1 });
    expect(await svc.run(new Date(NOW.getTime() + 60_000))).toEqual({ schools: 1, nudged: 0 });
    expect(written).toHaveLength(1);
  });

  it("a Can't earlier today for tomorrow does NOT silence the nudge: only a row marked nudgeFor counts", async () => {
    // The check asks for nudgeFor; a Can't notice carries only forDate, so it is not found.
    await new CoverNudgeService().run(NOW);
    expect(tx.notificationOutbox.findFirst.mock.calls[0][0].where.payload).toEqual({ path: ['nudgeFor'], equals: '2026-10-13' });
    expect(tx.notificationOutbox.create).toHaveBeenCalled();
  });

  it('nothing uncovered anywhere: nobody is bothered', async () => {
    platform.substitution.groupBy.mockResolvedValue([]);
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 0, nudged: 0 });
    expect(withTenantMock).not.toHaveBeenCalled();
    expect(requestOutboxDrain).not.toHaveBeenCalled();
  });

  it('gaps filled between the scan and the school\'s turn: nobody is bothered', async () => {
    tx.substitution.count.mockResolvedValue(0);
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 1, nudged: 0 });
    expect(tx.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it('tomorrow is a holiday (declared after the leave was approved): no nudge', async () => {
    tx.holiday.findMany.mockResolvedValue([{ startDate: new Date('2026-10-13'), endDate: null, name: 'Dussehra' }]);
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 1, nudged: 0 });
    expect(tx.notificationOutbox.create).not.toHaveBeenCalled();
  });

  it('tomorrow is a Sunday: no nudge', async () => {
    const saturday = new Date('2026-10-17T12:30:00Z');
    expect(await new CoverNudgeService().run(saturday)).toEqual({ schools: 1, nudged: 0 });
    expect(platform.substitution.groupBy.mock.calls[0][0].where.date).toEqual(new Date('2026-10-18'));
  });

  it('a school with nobody on the desk is not counted as nudged', async () => {
    tx.user.findMany.mockResolvedValue([]);
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 1, nudged: 0 });
  });

  it('one class reads in the singular', async () => {
    tx.substitution.count.mockResolvedValue(1);
    await new CoverNudgeService().run(NOW);
    expect(tx.notification.create.mock.calls[0][0].data.title).toBe('1 class has no teacher tomorrow');
  });

  it('"tomorrow" is the IST tomorrow: at 23:30 IST (18:00 UTC) it is already the next day in India', async () => {
    await new CoverNudgeService().run(new Date('2026-10-12T18:30:00Z')); // 00:00 IST on the 13th
    expect(platform.substitution.groupBy.mock.calls[0][0].where.date).toEqual(new Date('2026-10-14'));
  });

  it('one school failing does not stop the next', async () => {
    platform.substitution.groupBy.mockResolvedValue([{ schoolId: A }, { schoolId: B }]);
    withTenantMock.mockImplementationOnce(async () => { throw new Error('pooler timeout'); });
    expect(await new CoverNudgeService().run(NOW)).toEqual({ schools: 2, nudged: 1 });
    expect(withTenantMock).toHaveBeenCalledWith(B, expect.any(Function));
  });
});

describe('CoverNudgeController and its cron', () => {
  it('GET for Vercel Cron, POST for an operator, both behind CronSecretGuard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, CoverNudgeController.prototype.runFromCron)).toBe('cover-nudge');
    expect(Reflect.getMetadata(METHOD_METADATA, CoverNudgeController.prototype.runFromCron)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(METHOD_METADATA, CoverNudgeController.prototype.run)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, CoverNudgeController)).toBe('internal/cron');
    expect(Reflect.getMetadata(GUARDS_METADATA, CoverNudgeController)).toContain(CronSecretGuard);
  });

  it('runs the service for either verb', async () => {
    const nudge = { run: jest.fn().mockResolvedValue({ schools: 2, nudged: 1 }) };
    const c = new CoverNudgeController(nudge as never);
    await expect(c.runFromCron()).resolves.toEqual({ schools: 2, nudged: 1 });
    await expect(c.run()).resolves.toEqual({ schools: 2, nudged: 1 });
  });

  it('is registered with Vercel at 12:30 UTC — 18:00 IST', () => {
    const vercel = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'vercel.json'), 'utf8')) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toContainEqual({ path: '/internal/cron/cover-nudge', schedule: '30 12 * * *' });
  });
});
