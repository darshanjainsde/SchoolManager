import { TablePlan } from './schema-plan';

/**
 * MOVING ONE SCHOOL'S MANAGEMENT DATA ONTO ANOTHER SCHOOL.
 *
 * This is what makes a sample pack a pack rather than a copy of one school: the
 * rows arrive as the target school's own, reading as the current session.
 *
 * Four things change, and nothing else:
 *
 *  1. `schoolId` — every row in a backup has one by definition.
 *  2. Dates, by a whole number of WEEKS. Whole weeks because a register whose
 *     Mondays became Thursdays reads as nonsense: shifting by 7n keeps every
 *     attendance day on the weekday it was taken, and keeps a Sunday a Sunday.
 *  3. Student and staff codes, whose leading prefix is the source school's
 *     `codePrefix` (RPS-00042 → SNS-00042). A prefix swap is a bijection, so
 *     the per-school uniqueness of `code` survives it.
 *  4. Nothing else. In particular NOT the primary keys: they are UUIDs, so
 *     they cannot collide with another school's, and leaving them alone is what
 *     keeps every link inside the pack intact in a single pass.
 *
 * Logins need no rewriting either: `User` is unique on `(schoolId, email)`, so
 * one pack can be loaded into many schools at once and each school's copy of
 * `head@sample.test` is its own row. The password hashes travel, which is why a
 * pack's documented demo password keeps working wherever it lands.
 */
export interface RehomeOptions {
  /** The school the rows are becoming. */
  targetSchoolId: string;
  /** Whole weeks to add to every date. 0 leaves the pack frozen in time. */
  shiftWeeks: number;
  /** Student/staff code prefixes, source → target. Equal or null means no change. */
  codePrefix: { from: string | null; to: string | null };
}

/** Columns whose value starts with the school's code prefix. */
const CODE_COLUMNS = new Set(['code', 'admissionNo', 'employeeCode']);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whole weeks from one moment to another, rounded towards zero — so a pack
 * taken 10 days ago shifts by one week, not by one-and-a-bit.
 */
export const weeksBetween = (from: Date, to: Date): number =>
  Math.trunc((to.getTime() - from.getTime()) / WEEK_MS);

/**
 * Shifts one stored date value by whole weeks, keeping a date-only value
 * date-only. A date-only value is read as UTC midnight and written back as a
 * plain date: a whole number of weeks cannot cross a day boundary, so no
 * timezone can move the result off its weekday.
 */
export function shiftDate(value: string, weeks: number): string {
  if (weeks === 0 || !value) return value;
  const dateOnly = DATE_ONLY.test(value);
  const t = new Date(dateOnly ? `${value}T00:00:00.000Z` : value);
  if (Number.isNaN(t.getTime())) return value;
  const moved = new Date(t.getTime() + weeks * WEEK_MS).toISOString();
  return dateOnly ? moved.slice(0, 10) : moved;
}

/** One row, re-homed. Returns a new object; the input is untouched. */
export function rehomeRow(
  row: Record<string, unknown>, t: TablePlan, o: RehomeOptions,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row, schoolId: o.targetSchoolId };
  if (o.shiftWeeks !== 0) {
    for (const c of t.dateColumns) {
      const v = out[c];
      if (typeof v === 'string') out[c] = shiftDate(v, o.shiftWeeks);
    }
  }
  const { from, to } = o.codePrefix;
  if (from && to && from !== to) {
    for (const c of Object.keys(out)) {
      if (!CODE_COLUMNS.has(c)) continue;
      const v = out[c];
      if (typeof v === 'string' && v.startsWith(`${from}-`)) out[c] = `${to}-${v.slice(from.length + 1)}`;
    }
  }
  return out;
}

/**
 * Tables a sample pack must NOT carry, whatever bucket they are in: each one
 * would reach outside the demo. A pack is for showing a school what the product
 * looks like, so a push to a real handset or a live guest link has no business
 * travelling in one.
 *
 * Names are checked against the schema by `rehome.spec.ts`, so a rename cannot
 * quietly put one back into packs.
 */
export const PACK_EXCLUDED_MODELS: Readonly<Record<string, string>> = {
  PushToken: 'would send a demo notification to a real phone',
  AlumniAccessToken: 'a live link into an alumni account',
  GuestSession: 'a live guest login',
  EmailSuppression: "another school's unsubscribe list must not follow a pack",
  WhatsAppInbound: 'real messages real people sent',
  AuditLog: 'who did what in another school is not sample data',
};
