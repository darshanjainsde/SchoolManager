/**
 * Pure date math for leave applications and the coverage gaps they generate.
 * Kept dependency-free (no Prisma, no NestJS) so it's unit-testable directly,
 * mirroring `timetable-date.ts`.
 *
 * `LeaveApplication.startDate`/`endDate` and `Substitution.date` are all
 * `@db.Date` columns — plain calendar dates with no time component — so
 * everything here works in UTC-anchored date arithmetic (`new Date(
 * "YYYY-MM-DDT00:00:00Z")`) rather than IST-instant math like
 * `timetable-date.ts`'s `effectiveFrom`/`effectiveTo`. That keeps a leave
 * request for "2026-07-21..2026-07-23" meaning exactly those three calendar
 * days regardless of the server's local timezone.
 */
/**
 * `YYYY-MM-DD` for the IST calendar day containing `now` — "today" for
 * deciding which leave/attendance dates are still in the future. Comparing
 * this against another `YYYY-MM-DD` string with `>=`/`<` works directly
 * (lexicographic order matches chronological order for this format).
 */
export declare function todayIstDateStr(now: Date): string;
export declare function isValidDateStr(s: string): boolean;
/** `YYYY-MM-DD` for a `@db.Date` value as Prisma/pg hands it back. */
export declare function toDateStr(d: Date): string;
/**
 * ISO weekday (1=Mon … 7=Sun) of a `YYYY-MM-DD` date string — matches the
 * `TimetableSlot.dayOfWeek` / `School.workingDays` convention used across the
 * timetable feature. Computed in UTC so it never shifts with the server's
 * local timezone.
 */
export declare function isoWeekdayOf(dateStr: string): number;
/** Every `YYYY-MM-DD` date from `start` to `end` inclusive. Empty if `end < start`. */
export declare function dateRangeInclusive(start: string, end: string): string[];
//# sourceMappingURL=leave-dates.d.ts.map