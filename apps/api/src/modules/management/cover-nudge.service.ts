import { Injectable, Logger } from '@nestjs/common';
import { getPlatformPrisma, withTenant } from '@skoolos/db';
import { requestOutboxDrain } from '../../common/notifications/outbox-signal';
import { todayIstDateStr, toDateStr } from './internal/leave-dates';
import { workingDates } from './internal/school-calendar';
import { LeaveService } from './leave.service';

/** How far back a nudge for the same date counts as "already sent". */
export const NUDGE_WINDOW_MS = 12 * 3_600_000;

/**
 * THE 18:00 IST NUDGE (spec §4). For every school with a class tomorrow that
 * nobody is covering, ONE notice to the leave desk with the count. Runs from
 * Vercel Cron at 12:30 UTC.
 *
 * Schools are FOUND with one groupBy on the platform client (a cron has no
 * tenant); everything per school — the count, the calendar, the check and
 * the write — then runs inside withTenant.
 *
 * ONCE PER SCHOOL PER DATE, however often Vercel fires (it can fire twice,
 * and the two can overlap). The key is (school, date): a transaction-scoped
 * advisory lock on it serialises two runs for the same school, and under it
 * the second run sees the first one's committed nudge — marked with
 * `nudgeFor: <date>` — and writes nothing. A "Can't" or a reopened cover for
 * the same date carries no `nudgeFor`, so it never silences the evening nudge.
 */
@Injectable()
export class CoverNudgeService {
  private readonly logger = new Logger(CoverNudgeService.name);

  async run(now: Date = new Date()): Promise<{ schools: number; nudged: number }> {
    const today = todayIstDateStr(now);
    const tomorrow = toDateStr(new Date(Date.parse(`${today}T00:00:00Z`) + 24 * 3_600_000));
    const date = new Date(tomorrow);
    // Enumeration only: which schools have an open gap tomorrow.
    const open = await getPlatformPrisma().substitution.groupBy({
      by: ['schoolId'],
      where: { date, substituteTeacherId: null },
    });

    let nudged = 0;
    for (const { schoolId } of open) {
      try {
        const told = await withTenant(schoolId, async (tx) => {
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
            title: `${gaps} ${gaps === 1 ? 'class has' : 'classes have'} no teacher tomorrow`,
            body: day,
            linkId: null,
          });
        });
        if (told > 0) nudged += 1;
      } catch (e) {
        // One school failing (a pooler timeout) must not stop the next.
        this.logger.error(`Cover nudge for school ${schoolId} failed: ${(e as Error).message}`);
      }
    }
    if (nudged > 0) requestOutboxDrain();
    return { schools: open.length, nudged };
  }
}
