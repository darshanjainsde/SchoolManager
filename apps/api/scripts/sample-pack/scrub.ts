/**
 * Removes every phone number from the sample school before the pack is cut.
 *
 * The generator invents numbers in the real Indian mobile range (+91 6–9…), so
 * any of them may belong to a real person. A pack loaded into PRODUCTION (the
 * demo school Google's reviewers use) must hold none: one notice posted with
 * WhatsApp switched on would message strangers. Emails stay — they are all on
 * `sample.school` (no mail server) or `example.com` (reserved).
 *
 * The columns are found from the database itself, not from a list, so a phone
 * column added to the schema later is scrubbed too — and the run FAILS if any
 * number survives, rather than trusting the UPDATEs.
 */
import type { RawDb } from '../../src/modules/backups/engine/db';

/** A column that can hold a phone number: phone, mobile, whatsapp… — text only. */
export const PHONE_COLUMN = /(phone|mobile|whatsapp)/i;
/** Text columns that match the pattern but are not a person's number. */
const NOT_A_NUMBER = new Set(['phoneNumberId', 'phoneOtpHash']);

interface Col { table: string; column: string; nullable: boolean; scoped: boolean }

async function phoneColumns(db: RawDb): Promise<Col[]> {
  const rows = await db.query<{ table_name: string; column_name: string; is_nullable: string; scoped: boolean }>(
    `SELECT c.table_name, c.column_name, c.is_nullable,
            EXISTS (SELECT 1 FROM information_schema.columns s
                    WHERE s.table_schema = 'public' AND s.table_name = c.table_name AND s.column_name = 'schoolId') AS scoped
       FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying')`,
  );
  return rows
    .filter((r) => PHONE_COLUMN.test(r.column_name) && !NOT_A_NUMBER.has(r.column_name))
    .map((r) => ({ table: r.table_name, column: r.column_name, nullable: r.is_nullable === 'YES', scoped: r.scoped }));
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Blank every phone in the school; returns how many values were removed per column. Throws if any survive. */
export async function scrubPhones(db: RawDb, schoolId: string): Promise<Record<string, number>> {
  const cols = await phoneColumns(db);
  const removed: Record<string, number> = {};
  const nonEmpty = (c: Col) => `${q(c.column)} IS NOT NULL AND ${q(c.column)} <> ''`;

  for (const c of cols) {
    const where = c.scoped ? `"schoolId" = $1::uuid AND ${nonEmpty(c)}` : nonEmpty(c);
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${q(c.table)} WHERE ${where}`, ...(c.scoped ? [schoolId] : []));
    if (n === 0) continue;
    // A table with no schoolId cannot be filtered to this school: refuse rather than guess.
    if (!c.scoped) throw new Error(`${c.table}.${c.column} holds ${n} phone value(s) and has no schoolId — scrub it explicitly`);
    await db.query(`UPDATE ${q(c.table)} SET ${q(c.column)} = ${c.nullable ? 'NULL' : `''`} WHERE ${where}`, schoolId);
    removed[`${c.table}.${c.column}`] = n;
  }
  // A verified-at stamp on a number that no longer exists would read as a verified phone.
  await db.query(`UPDATE "User" SET "phoneVerifiedAt" = NULL WHERE "schoolId" = $1::uuid`, schoolId);

  // Prove it from scratch, across every phone column in the database.
  const left: string[] = [];
  for (const c of cols) {
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${q(c.table)} WHERE ${nonEmpty(c)}`);
    if (n > 0) left.push(`${c.table}.${c.column}: ${n}`);
  }
  if (left.length) throw new Error(`phone numbers survived the scrub: ${left.join(', ')}`);
  return removed;
}
