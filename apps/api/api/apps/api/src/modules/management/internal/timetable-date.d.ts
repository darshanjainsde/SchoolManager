/**
 * Pure date math for effective-dated `TimetableSlot` rows. Kept
 * dependency-free (no Prisma, no NestJS) so the day-boundary rules can be
 * unit tested directly against fixed clocks.
 *
 * The deployment region is `bom1` (India) and school days are IST days (see
 * `common/notifications/format.ts` and `portal.service.ts`'s attendance
 * month), so versioning is anchored to IST-calendar-day boundaries rather
 * than UTC ones — otherwise a change made between 00:00–05:29 IST (still
 * "yesterday" in UTC) would land in the wrong day's version. `effectiveFrom`
 * / `effectiveTo` are always midnight-IST instants, and reads compare
 * against the midnight-IST instant of the requested day.
 */
/** The instant that is midnight IST on the IST calendar day containing `d`. */
export declare function startOfIstDay(d: Date): Date;
/** True when `a` and `b` fall on the same IST calendar day. */
export declare function isSameIstDay(a: Date, b: Date): boolean;
/**
 * Resolves the `date` query param (`YYYY-MM-DD`, an IST calendar date) into
 * the midnight-IST instant to read the timetable "as of". Falls back to
 * `startOfIstDay(now)` when `dateParam` is absent or malformed, so a bad
 * query param behaves like "today" rather than erroring.
 */
export declare function resolveAsOfDate(dateParam: string | undefined, now: Date): Date;
/**
 * Today's calendar date in IST as `YYYY-MM-DD` — the timezone a school day is
 * judged in. Not `toISOString().slice(0,10)` on a bare `new Date()`, which
 * reports the UTC day and rolls backwards for any IST evening after 18:30.
 */
export declare function istTodayISO(now?: Date): string;
//# sourceMappingURL=timetable-date.d.ts.map