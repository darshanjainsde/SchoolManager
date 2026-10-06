import { createHash } from 'node:crypto';
import type { ColumnInfo } from './db';
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
 *  4. Every id — the primary key and every uuid column pointing at one.
 *
 * That last one is not optional, and the comment here used to claim the
 * opposite. A uuid primary key means the new row will not collide with a
 * DIFFERENT row; it says nothing about re-inserting the SAME row's id, which
 * is exactly what loading a pack does when the school it was cut from lives in
 * the same database — the ordinary demo case. Every insert then fails on the
 * primary key, the importer swallows it as "a unique value is already taken",
 * and the load reports success having dropped everything.
 *
 * So each id is mapped to a NEW one, derived from the old id and the target
 * school. Deriving rather than allocating is what keeps it a single pass: a
 * child row's pointer maps to the same value its parent's key did without
 * anything having to remember what the parent became.
 *
 * Every uuid column is mapped, not only the ones the schema declares as
 * foreign keys — a soft reference left alone (a `photoAssetId` with no
 * constraint behind it) would go on pointing at the SOURCE school's row, which
 * is a cross-tenant leak rather than a dangling link. A pointer that genuinely
 * aimed outside the pack becomes dangling instead, and the import's own
 * accounting then clears it or drops the row and SAYS SO.
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
  /**
   * Map every id to a new one. Required whenever the rows are going onto a
   * DIFFERENT school, because the school they came from may be in this very
   * database. False when a school's own archive is going back into it, where
   * the ids have just been emptied out and are the rows' real identities.
   */
  remapIds: boolean;
}

/**
 * A new id for an old one, derived rather than allocated: the same input always
 * gives the same output, so a child's pointer and its parent's key map to the
 * same value without a lookup table — and two schools loading the same pack get
 * different ids, so neither can collide with the other.
 *
 * Shaped as a version-5 UUID (SHA-256 truncated, version and variant bits set)
 * so Postgres and every client read it as an ordinary uuid.
 */
export function derivedUuid(namespace: string, value: string): string {
  const h = createHash('sha256').update(namespace).update('\u0000').update(value).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * One row, re-homed. Returns a new object; the input is untouched.
 *
 * `columns` comes from the TARGET database, so which columns hold an id is read
 * from the table itself rather than guessed from the schema — including uuid
 * ARRAYS, which carry references just as a single column does.
 */
export function rehomeRow(
  row: Record<string, unknown>, t: TablePlan, columns: ColumnInfo[], o: RehomeOptions,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row, schoolId: o.targetSchoolId };
  if (o.remapIds) {
    const map = (v: unknown) =>
      (typeof v === 'string' && UUID_VALUE.test(v) ? derivedUuid(o.targetSchoolId, v) : v);
    for (const c of columns) {
      if (c.name === 'schoolId' || !(c.name in out)) continue;
      if (c.udt === 'uuid') out[c.name] = map(out[c.name]);
      else if (c.udt === '_uuid' && Array.isArray(out[c.name])) {
        out[c.name] = (out[c.name] as unknown[]).map(map);
      }
    }
  }
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
  NotificationOutbox: "an unsent row would be expanded and sent to the receiving school's real people",
  NotificationDelivery: "a QUEUED delivery would be sent to the receiving school's real people",
  AuditLog: 'who did what in another school is not sample data',
};
