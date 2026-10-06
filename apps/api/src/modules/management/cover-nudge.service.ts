import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import { invocationStartedAt } from '../../common/notifications/invocation-clock';
import { requestOutboxDrain } from '../../common/notifications/outbox-signal';
import { todayIstDateStr, toDateStr } from './internal/leave-dates';
import { workingDates } from './internal/school-calendar';
import { LeaveService } from './leave.service';

/** How far back a nudge for the same date counts as "already sent". */
export const NUDGE_WINDOW_MS = 12 * 3_600_000;

/**
 * Schools nudged at once. Each one is its own tenant transaction holding a
 * pooled connection, so this is kept below the tenant client's pool (a
 * transaction that waits more than `maxWait` for a connection fails, and that
 * school would then wait for the resume run).
 */
export const NUDGE_CONCURRENCY = 5;

/**
 * No new school is STARTED after this much of the invocation has gone. The
 * function is killed at 60 s (apps/api/vercel.json) counted from when the
 * INVOCATION began (invocation-clock.ts); 45 s leaves a chunk already in
 * flight the time to commit. Schools not started are picked up by the resume
 * cron fifteen minutes later.
 */
export const NUDGE_TIME_BUDGET_MS = 45_000;

/** `run()`'s answer: schools with an open gap tomorrow, how many were nudged, how many were left for the resume run. */
export interface CoverNudgeRunResult {
  schools: number;
  nudged: number;
  left: number;
}

/**
 * THE 18:00 IST NUDGE (spec §4). For every school with a period tomorrow that
 * nobody is covering, ONE notice to the leave desk with the count. Runs from
 * Vercel Cron at 12:30 UTC, and again at 12:45 UTC as a RESUME: a run that
 * reached its deadline leaves the rest, and the second run finishes them.
 *
 * Schools are FOUND with one groupBy on the platform client (a cron has no
 * tenant); everything per school — the count, the calendar, the check and
 * the write — then runs inside withTenant, a few schools at a time.
 *
 * ONCE PER SCHOOL PER DATE, however often it fires (Vercel can fire twice,
 * the two can overlap, and the resume run passes every school again). The key
 * is (school, date): a transaction-scoped advisory lock on it serialises two
 * runs for the same school, and under it the second run sees the first one's
 * committed nudge — marked with `nudgeFor: <date>` — and writes nothing. A
 * "Can't" or a reopened cover for the same date carries no `nudgeFor`, so it
 * never silences the evening nudge.
 */
@Injectable()
export class CoverNudgeService {
  private readonly logger = new Logger(CoverNudgeService.name);

  async run(now: Date = new Date()): Promise<CoverNudgeRunResult> {
    // The deadline counts from when the invocation began when that is known
    // (a cold start may already have used some of the 60 s), else from here.
    const deadline = (invocationStartedAt() ?? Date.now()) + NUDGE_TIME_BUDGET_MS;
    const today = todayIstDateStr(now);
    const tomorrow = toDateStr(new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 3_600_000));
    const date = new Date(tomorrow);
    // Enumeration only: which schools have an open gap tomorrow. In a fixed
    // order, so a run cut short and its resume walk the same list.
    const open = await getPlatformPrisma().substitution.groupBy({
      by: ['schoolId'],
      where: { date, substituteTeacherId: null },
      orderBy: { schoolId: 'asc' },
    });
    const all = open.map((o) => o.schoolId);
    // Schools already nudged for this date — by the 12:30 run, when this is the
    // resume — are dropped with ONE read, so the resume spends its time on the
    // schools the first run did not reach, not on a transaction each to find
    // out it has nothing to do. Only a shortcut: the check under the lock in
    // nudgeSchool() is still what makes a second nudge impossible.
    const done = all.length
      ? await getPlatformPrisma().notificationOutbox.findMany({
          where: { schoolId: { in: all }, kind: 'COVER_UNFILLED', createdAt: { gte: new Date(now.getTime() - NUDGE_WINDOW_MS) }, payload: { path: ['nudgeFor'], equals: tomorrow } },
          select: { schoolId: true },
          distinct: ['schoolId'],
        })
      : [];
    const already = new Set(done.map((d) => d.schoolId));
    const schoolIds = all.filter((id) => !already.has(id));

    let nudged = 0;
    let left = 0;
    for (let i = 0; i < schoolIds.length; i += NUDGE_CONCURRENCY) {
      if (Date.now() >= deadline) {
        left = schoolIds.length - i;
        this.logger.warn(`Cover nudge stopped at its deadline with ${left} of ${all.length} schools not started; the resume run picks them up.`);
        break;
      }
      const batch = schoolIds.slice(i, i + NUDGE_CONCURRENCY);
      const settled = await Promise.allSettled(batch.map((schoolId) => this.nudgeSchool(schoolId, now, tomorrow, date)));
      settled.forEach((outcome, j) => {
        if (outcome.status === 'fulfilled') {
          if (outcome.value > 0) nudged += 1;
        } else {
          // One school failing (a pooler timeout) must not stop the next.
          this.logger.error(`Cover nudge for school ${batch[j]} failed: ${(outcome.reason as Error)?.message}`);
        }
      });
    }
    if (nudged > 0) requestOutboxDrain();
    return { schools: all.length, nudged, left };
  }

  /** One school's nudge, inside its tenant. Returns how many desk members were told (0 = nothing sent). */
  private nudgeSchool(schoolId: string, now: Date, tomorrow: string, date: Date): Promise<number> {
    return withTenant(schoolId, async (tx) => {
      // ::text — pg_advisory_xact_lock returns void, which $queryRaw cannot read.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${schoolId}), hashtext(${`cover-nudge:${tomorrow}`}))::text`;
      const already = await tx.notificationOutbox.findFirst({
        where: { schoolId, kind: 'COVER_UNFILLED', createdAt: { gte: new Date(now.getTime() - NUDGE_WINDOW_MS) }, payload: { path: ['nudgeFor'], equals: tomorrow } },
        select: { id: true },
      });
      if (already) return 0;
      // A holiday declared after the leave was approved: nobody teaches, so nothing to cover.
      if ((await workingDates(tx, schoolId, tomorrow, tomorrow)).length === 0) return 0;
      const gaps = await tx.substitution.count({ where: { schoolId, date, substituteTeacherId: null } });
      if (gaps === 0) return 0;
      const school = await tx.school.findFirst({ where: { id: schoolId }, select: { name: true } });
      const day = LeaveService.datesLabel(tomorrow, tomorrow);
      return LeaveService.tellDesk(tx, schoolId, {
        kind: 'COVER_UNFILLED',
        payload: { schoolName: school?.name ?? 'Your school', gaps, forDate: tomorrow, forWhen: `tomorrow, ${day}`, note: null, nudgeFor: tomorrow },
        // A gap is one PERIOD of one class, and the count is of gaps: "4
        // periods", as the email and the push say — never "4 classes" for
        // what may be one class's four empty periods.
        title: `${gaps} ${gaps === 1 ? 'period has' : 'periods have'} no teacher tomorrow`,
        body: day,
        linkId: null,
      });
    });
  }
}
