/**
 * ONE WAY TO WRITE A DATE IN THIS APP — the Indian order, "8 Oct 2026".
 *
 * The re-audit of 2026-10-08 found six shapes on screen at once: "Oct 1,
 * 2026" (attendance), "1 Oct" (notices), "8 Oct 2026" (leave form), "Thu,
 * Oct 1" (diary), "Aug 5, 2026" (fees), and a raw "2026-10-06" (registers).
 * The US ones came from `toLocaleDateString(undefined, …)`, which follows the
 * PHONE's language (an emulator or an English-US phone says "Oct 1"), and from
 * a bare `toLocaleString()`. The Hermes `Intl` data is also not to be trusted
 * with `en-IN` (lib/money.ts found it grouping lakhs wrongly). So this is done
 * by hand: no Intl, the same output on every phone and in every test.
 *
 * Inputs are what the API sends:
 *  - a calendar date `YYYY-MM-DD` (or one with a midnight-UTC time attached)
 *    is a DAY, read from its digits — never shifted by the phone's time zone;
 *  - any other timestamp is a MOMENT, read on the phone's own clock.
 * Guarded by src/__tests__/dates-standard.test.ts.
 */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type DateIn = string | Date;

/** A calendar day: date-only strings and midnight-UTC stamps keep their own digits. */
function asDay(v: DateIn): Date {
  if (v instanceof Date) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(v);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(v);
}

/** A moment on the phone's clock. */
function asMoment(v: DateIn): Date {
  return v instanceof Date ? v : new Date(v);
}

/** "8 Oct" */
export function fmtDay(v: DateIn): string {
  const d = asDay(v);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

/** "8 Oct 2026" */
export function fmtDate(v: DateIn): string {
  const d = asDay(v);
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Thu, 8 Oct" */
export function fmtWeekdayDay(v: DateIn): string {
  const d = asDay(v);
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
}

/** "Thu, 8 Oct 2026" */
export function fmtWeekdayDate(v: DateIn): string {
  const d = asDay(v);
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

/** "Thursday, 8 October" — the date line at the top of a Home. */
export function fmtLongDay(v: DateIn): string {
  const d = asDay(v);
  return `${WEEKDAY[d.getDay()]}, ${d.getDate()} ${MONTH[d.getMonth()]}`;
}

/** "Thu" */
export function fmtWeekdayShort(v: DateIn): string {
  return WD[asDay(v).getDay()];
}

/** "October 2026" */
export function fmtMonthYear(year: number, monthIndex: number): string {
  return `${MONTH[monthIndex]} ${year}`;
}

/** "12:57 pm" */
export function fmtTime(v: DateIn): string {
  const d = asMoment(v);
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

/** "8 Oct, 12:57 pm" — a message or notice this year. */
export function fmtDayTime(v: DateIn): string {
  const d = asMoment(v);
  return `${d.getDate()} ${MON[d.getMonth()]}, ${fmtTime(d)}`;
}

/** "8 Oct 2026, 12:57 pm" */
export function fmtDateTime(v: DateIn): string {
  const d = asMoment(v);
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${fmtTime(d)}`;
}

/**
 * THE SCHOOL'S CLOCK. Some moments are read in the school's time whatever
 * the phone says — "seen 8:10 am" on the leave desk, the date a report card
 * was issued. Every school on Sckools is in India (IST, UTC+5:30, no daylight
 * saving), so this is a fixed shift, done by hand like everything here. A
 * refactor once swapped these for the phone clock and only a UTC CI runner
 * noticed (2026-10-08): keep the zone where the meaning needs it.
 */
function inSchoolClock(v: DateIn): Date {
  const d = asMoment(v);
  return new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60_000);
}

/** "8:10 am", in the school's time (IST). */
export function fmtSchoolTime(v: DateIn): string {
  return fmtTime(inSchoolClock(v));
}

/** "8 Oct 2026", the school's calendar day (IST) of a moment. */
export function fmtSchoolDate(v: DateIn): string {
  return fmtDate(inSchoolClock(v));
}
