/**
 * Birthday date maths (Active Roster, Track B), in the SCHOOL's timezone.
 *
 * The API elsewhere hard-codes Asia/Kolkata; a birthday wall that reads the
 * process clock shows tomorrow's children at 11 pm, which is the one bug every
 * school would notice on day one. Everything here takes a `tz` and a `now`, so
 * it is pure and testable, and it never lets a year leave the module: the wire
 * shape is day + month only.
 */
export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export type BirthdayWindow = 'TODAY' | 'WEEK' | 'MONTH';
export type NameFormat = 'FIRST' | 'FIRST_INITIAL' | 'FULL';

function parts(tz: string, now: Date): Ymd & { hh: number; mm: number; ss: number } {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const get = (type: string) => Number(f.formatToParts(now).find((p) => p.type === type)?.value);
  // Some engines print midnight as "24"; normalise so seconds-to-midnight is right.
  return { y: get('year'), m: get('month'), d: get('day'), hh: get('hour') % 24, mm: get('minute'), ss: get('second') };
}

export function todayInZone(tz: string, now: Date = new Date()): Ymd {
  const p = parts(tz, now);
  return { y: p.y, m: p.m, d: p.d };
}

export function addDays(a: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(a.y, a.m - 1, a.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The day a birthday falls on in `year`: 29 Feb becomes 28 Feb in a non-leap year. */
export function effectiveDayMonth(dob: Date, year: number): { m: number; d: number } {
  const m = dob.getUTCMonth() + 1;
  const d = dob.getUTCDate();
  if (m === 2 && d === 29 && !isLeap(year)) return { m: 2, d: 28 };
  return { m, d };
}

const ord = (x: Ymd) => x.y * 10000 + x.m * 100 + x.d;

/** True when the birthday's next occurrence lies within [start, end] (inclusive), across a year wrap. */
export function inWindow(dob: Date, start: Ymd, end: Ymd): boolean {
  const years = start.y === end.y ? [start.y] : [start.y, end.y];
  for (const year of years) {
    const { m, d } = effectiveDayMonth(dob, year);
    const o = ord({ y: year, m, d });
    if (o >= ord(start) && o <= ord(end)) return true;
  }
  return false;
}

export function formatName(first: string, last: string, fmt: NameFormat): string {
  const f = first.trim();
  const l = last.trim();
  if (fmt === 'FULL') return [f, l].filter(Boolean).join(' ');
  if (fmt === 'FIRST_INITIAL' && l) return `${f} ${l[0].toUpperCase()}.`;
  return f;
}

/** Whole seconds until the school's next local midnight — the public cache lifetime. */
export function secondsToMidnight(tz: string, now: Date = new Date()): number {
  const p = parts(tz, now);
  return 24 * 3600 - (p.hh * 3600 + p.mm * 60 + p.ss);
}

export function windowBounds(window: BirthdayWindow, today: Ymd): { start: Ymd; end: Ymd } {
  if (window === 'TODAY') return { start: today, end: today };
  if (window === 'WEEK') return { start: today, end: addDays(today, 6) };
  const last = new Date(Date.UTC(today.y, today.m, 0)).getUTCDate();
  return { start: { y: today.y, m: today.m, d: 1 }, end: { y: today.y, m: today.m, d: last } };
}

/** Days from `today` to the birthday's next occurrence (0 = today), wrapping through the year. */
export function daysUntil(day: number, month: number, today: Ymd): number {
  const t = Date.UTC(today.y, today.m - 1, today.d);
  let b = Date.UTC(today.y, month - 1, day);
  if (b < t) b = Date.UTC(today.y + 1, month - 1, day);
  return Math.round((b - t) / 86_400_000);
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const ymdString = (x: Ymd) => `${x.y}-${pad2(x.m)}-${pad2(x.d)}`;
