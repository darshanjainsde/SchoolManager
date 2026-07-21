/**
 * Pure date-window math for the exam-reminder cron. Kept dependency-free
 * (no Prisma, no NestJS) so the "exactly T-2 / T-1 days, and nothing else"
 * behaviour can be unit tested directly against fixed clocks, independent of
 * any DB mock.
 *
 * "T-2 days" / "T-1 day" means: `scheduledAt` falls anywhere within the UTC
 * calendar day that is exactly 2 (or 1) days after `now`'s UTC calendar day
 * — not a rolling 48h/24h window, so a test scheduled at 00:05 UTC two days
 * out is still caught even if the cron runs at 03:00 UTC.
 */

export interface DayRange {
  gte: Date;
  lt: Date;
}

function utcDayRange(base: Date, offsetDays: number): DayRange {
  const gte = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offsetDays),
  );
  const lt = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offsetDays + 1),
  );
  return { gte, lt };
}

export interface ReminderWindows {
  twoDaysOut: DayRange;
  oneDayOut: DayRange;
}

export function reminderWindows(now: Date): ReminderWindows {
  return {
    twoDaysOut: utcDayRange(now, 2),
    oneDayOut: utcDayRange(now, 1),
  };
}

/**
 * How many days out `scheduledAt` is, for reminder purposes: `2` or `1` when
 * it falls inside the T-2 / T-1 window relative to `now`, and `null` when it
 * is outside both (i.e. no reminder is due).
 *
 * `ExamRemindersService` calls this for the exams the date-range query
 * returned, so the "which window is this?" rule lives in exactly one place
 * and is unit tested against fixed clocks.
 */
export function reminderDaysUntil(scheduledAt: Date, now: Date): 1 | 2 | null {
  const { twoDaysOut, oneDayOut } = reminderWindows(now);
  if (scheduledAt >= twoDaysOut.gte && scheduledAt < twoDaysOut.lt) return 2;
  if (scheduledAt >= oneDayOut.gte && scheduledAt < oneDayOut.lt) return 1;
  return null;
}
