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

const TIME_ZONE = 'Asia/Kolkata';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const IST_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` for the IST calendar day containing `d`. */
function istDayString(d: Date): string {
  return IST_DAY_FORMATTER.format(d);
}

/** The instant that is midnight IST on the IST calendar day containing `d`. */
export function startOfIstDay(d: Date): Date {
  return new Date(`${istDayString(d)}T00:00:00+05:30`);
}

/** True when `a` and `b` fall on the same IST calendar day. */
export function isSameIstDay(a: Date, b: Date): boolean {
  return istDayString(a) === istDayString(b);
}

/**
 * Resolves the `date` query param (`YYYY-MM-DD`, an IST calendar date) into
 * the midnight-IST instant to read the timetable "as of". Falls back to
 * `startOfIstDay(now)` when `dateParam` is absent or malformed, so a bad
 * query param behaves like "today" rather than erroring.
 */
export function resolveAsOfDate(dateParam: string | undefined, now: Date): Date {
  if (dateParam && DATE_RE.test(dateParam)) {
    return new Date(`${dateParam}T00:00:00+05:30`);
  }
  return startOfIstDay(now);
}

/**
 * THE ONE "LIVE ON THIS DATE" RULE for a timetable slot: `effectiveFrom <=
 * date AND (effectiveTo IS NULL OR effectiveTo > date)`, the date read as an
 * IST day. Approve's gaps, the apply notice's "N periods to cover", the cover
 * card's subject, freeTeachersFor and the WhatsApp list all spread this — a
 * timetable published mid-leave changes every one of their answers together.
 */
export function liveSlotWhere(dateStr: string, now: Date = new Date()) {
  const asOf = resolveAsOfDate(dateStr, now);
  return { effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }] };
}

/**
 * Today's calendar date in IST as `YYYY-MM-DD` — the timezone a school day is
 * judged in. Not `toISOString().slice(0,10)` on a bare `new Date()`, which
 * reports the UTC day and rolls backwards for any IST evening after 18:30.
 */
export function istTodayISO(now: Date = new Date()): string {
  return istDayString(now);
}

/**
 * A date a parent reads, in the school's own idiom: "2 November".
 *
 * No year, because every notice that carries one is about this week or the
 * next; no weekday, because the sentence around it already says what the day
 * is for. Fixed to en-IN and IST so the same notice reads the same on a
 * server in Mumbai and one in Washington — `toLocaleDateString` with no
 * timezone would drift a day either side of midnight.
 */
export function readableIstDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(d);
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * "Mon 13 Oct 2026" — a calendar date as WhatsApp templates print it. Reads
 * the UTC fields: pass a date at UTC midnight (a @db.Date column, or
 * `new Date('2026-10-13T00:00:00Z')`). Fixed arrays, not Intl, because ICU
 * writes September as "Sept" in en-IN and en-GB.
 */
export function shortDayDate(d: Date): string {
  return `${SHORT_DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
