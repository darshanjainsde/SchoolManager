import type { RawDb } from './db';
import { SchemaPlan, q } from './schema-plan';
import { ObjectStore, schoolPrefixes } from './store';

/**
 * REMOVES ONE SCHOOL COMPLETELY — every row it owns and every file it stored.
 *
 * It does NOT rely on ON DELETE CASCADE from School, because that was not
 * enough (see the 2026-10-01 audit):
 *  - five RESTRICT links (fee invoices, plan items, ticket registrations) made
 *    Postgres refuse the cascade for any school that had billed or sold a
 *    ticket;
 *  - `Exam` and `OtpChallenge` have no foreign key to School at all, so the
 *    cascade never reached them;
 *  - the fee ledger and the certificate register refuse deletes outright.
 *
 * Instead, in ONE transaction:
 *  1. name this school as the one being purged — the two registers allow a
 *     delete only for that school, and only while it is SUSPENDED;
 *  2. walk every school table children-first; before each one, clear any
 *     RESTRICT rows pointing into this school's rows (they may belong to
 *     another school — a family registered for this school's network event);
 *  3. delete the School row last.
 * Any failure rolls the whole thing back: the school is exactly as it was.
 *
 * The caller must suspend the school first. Purging a LIVE school is refused
 * here as well, so no path can skip that step.
 */
export async function purgeSchoolRows(db: RawDb, plan: SchemaPlan, schoolId: string): Promise<void> {
  const [school] = await db.query<{ status: string }>(`SELECT status::text AS status FROM "School" WHERE id = $1::uuid`, schoolId);
  if (!school) return; // already gone — purging is idempotent
  if (school.status !== 'SUSPENDED') {
    throw new Error(`refusing to purge a school that is ${school.status} — suspend it first`);
  }
  const statements: { sql: string; params?: unknown[] }[] = [
    { sql: `SELECT set_config('sckools.purge_school', $1, true)`, params: [schoolId] },
  ];
  for (const table of plan.excludedTables) {
    statements.push({ sql: `DELETE FROM ${q(table)} WHERE "schoolId" = $1::uuid`, params: [schoolId] });
  }
  for (const t of plan.deleteOrder) {
    for (const r of plan.inboundRestricts.get(t.table) ?? []) {
      const childCols = r.childColumns.map(q).join(', ');
      const parentCols = r.parentColumns.map(q).join(', ');
      statements.push({
        sql: `DELETE FROM ${q(r.childTable)} WHERE (${childCols}) IN (SELECT ${parentCols} FROM ${q(t.table)} WHERE "schoolId" = $1::uuid)`,
        params: [schoolId],
      });
    }
    statements.push({ sql: `DELETE FROM ${q(t.table)} WHERE "schoolId" = $1::uuid`, params: [schoolId] });
  }
  statements.push({ sql: `DELETE FROM "School" WHERE id = $1::uuid`, params: [schoolId] });
  await db.transaction(statements);
}

/** Every file under the school's folders, in every bucket. Returns how many went. */
export async function purgeSchoolFiles(store: ObjectStore, schoolId: string): Promise<number> {
  let n = 0;
  for (const prefix of schoolPrefixes(schoolId)) n += await store.deletePrefix(prefix);
  return n;
}
