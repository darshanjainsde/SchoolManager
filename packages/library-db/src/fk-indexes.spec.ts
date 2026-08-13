import { getLibraryPlatformPrisma } from './index';
import { describeLive } from './test-live';

/**
 * Every foreign key column must have an index that can serve a lookup on that
 * column ALONE.
 *
 * Postgres checks referencing rows whenever a PARENT row is deleted. If the
 * child's FK column has no usable index, that check is a sequential scan of the
 * whole child table, once per deleted parent row. Nothing fails; it just gets
 * slower, in proportion to data the school accumulates — so it is invisible in
 * review, invisible in a fresh test database, and expensive exactly when a
 * library has years of history.
 *
 * This guard exists because it already happened. `LostReport` shipped with only
 * composite indexes led by `orgId`, which cannot serve a lookup by `copyId`, and
 * the e2e authz-matrix suite — which creates and tears down orgs constantly —
 * went from 17 seconds to 823. The tests still PASSED; only the clock said
 * anything was wrong, and the preflight gate failed on a timeout that looked
 * like flakiness. Adding the seven missing indexes took it to 7 seconds.
 *
 * A composite index counts only when the FK column is its FIRST column, which is
 * what `indkey[0] = attnum` checks. Partial indexes are excluded (`indpred IS
 * NULL`): `lost_report_one_open_per_copy` is on `copyId` but only covers open
 * rows, so Postgres cannot use it for a general FK check.
 *
 * The identifier strings below are composed from `pg_namespace`/`pg_class`
 * rather than from `conrelid::regclass::text`: a reg* cast omits the schema when
 * it is on the current role's search_path and includes it when it is not, so the
 * same query returns different strings depending on who is connected — and the
 * app roles here carry `search_path=library,...` while psql as `postgres` does
 * not. The first version of this file compared against psql's output and every
 * baseline entry missed.
 */

/**
 * Foreign keys that were ALREADY unindexed when this guard was written, on
 * tables P3.1 did not touch. Listed by name, the same shape as
 * `RLS_ALLOW_LIST` and `FORBIDDEN_VALUE_EXCEPTIONS`, so the guard protects new
 * work from today without silently blessing the backlog: adding an entry here
 * is a deliberate act visible in review, and the list should only ever shrink.
 *
 * These are real debt, not false positives. `Issue.copyId`, `Issue.memberId`
 * and `Fine.memberId` in particular are on the hottest delete paths in the
 * service. Fixing them is a separate change with its own measurement, because
 * every index also costs on write and these tables carry a school's whole
 * history — it should not ride along inside a lost-books migration.
 */
export const UNINDEXED_FK_BASELINE = [
  'Category.parentId',
  'CirculationPolicy.branchId',
  'ClassVisit.branchId',
  'ClassVisit.periodId',
  'Copy.branchId',
  'Fine.issueId',
  'Fine.memberId',
  'Fine.waivedByUserId',
  'Issue.branchId',
  'Issue.copyId',
  'Issue.issuedByUserId',
  'Issue.memberId',
  'Issue.returnedByUserId',
  'Member.homeBranchId',
  'Reservation.branchId',
  'Reservation.memberId',
  'Reservation.readyCopyId',
  'Reservation.titleId',
  'VisitAttendance.memberId',
];

describeLive('every foreign key is indexed', () => {
  it('has no FK column that would force a sequential scan on parent delete', async () => {
    const prisma = getLibraryPlatformPrisma();

    const unindexed = await prisma.$queryRaw<Array<{ table: string; column: string }>>`
      SELECT cl.relname AS "table", a.attname AS "column"
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND n.nspname = 'library'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_index x
          WHERE x.indrelid = c.conrelid
            AND x.indkey[0] = a.attnum
            AND x.indpred IS NULL
        )
      ORDER BY 1, 2
    `;

    // Named in the failure so the fix is obvious: add @@index([<column>]) to the
    // model and a matching CREATE INDEX to the migration.
    const offenders = unindexed
      .map((r) => `${r.table}.${r.column}`)
      .filter((fk) => !UNINDEXED_FK_BASELINE.includes(fk));

    expect(offenders).toEqual([]);
  });

  it('regression: a NEWLY unindexed foreign key is caught, not swallowed by the baseline', async () => {
    // Proves the filter above discriminates. Without this, a baseline that
    // accidentally matched everything would make the guard permanently green —
    // the exact vacuous-pass failure mode the RLS audit's own tablesChecked
    // guard exists to prevent.
    const prisma = getLibraryPlatformPrisma();
    const all = await prisma.$queryRaw<Array<{ table: string; column: string }>>`
      SELECT cl.relname AS "table", a.attname AS "column"
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND n.nspname = 'library'
    `;
    const pretendNew = 'Pretend.newlyAddedFk';
    const offenders = [...all.map((r) => `${r.table}.${r.column}`), pretendNew].filter(
      (fk) => !UNINDEXED_FK_BASELINE.includes(fk),
    );
    expect(offenders).toContain(pretendNew);
  });

  it('the baseline has not rotted — every entry still names a real unindexed FK', async () => {
    // A baseline entry that no longer matches anything is either a fixed FK
    // (delete the line, and the guard gets stronger) or a typo (the guard is
    // weaker than it looks and nobody can tell). Either way it should be said
    // out loud rather than sitting there.
    const prisma = getLibraryPlatformPrisma();
    const unindexed = await prisma.$queryRaw<Array<{ table: string; column: string }>>`
      SELECT cl.relname AS "table", a.attname AS "column"
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f'
        AND n.nspname = 'library'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index x
          WHERE x.indrelid = c.conrelid AND x.indkey[0] = a.attnum AND x.indpred IS NULL
        )
    `;
    const actual = new Set(unindexed.map((r) => `${r.table}.${r.column}`));
    const stale = UNINDEXED_FK_BASELINE.filter((fk) => !actual.has(fk));
    expect(stale).toEqual([]);
  });

  it('actually inspected some foreign keys, rather than passing on an empty schema', async () => {
    // The same vacuity guard the RLS audit carries: a query that finds zero
    // offenders because it found zero TABLES is not a pass.
    const prisma = getLibraryPlatformPrisma();
    const [{ count }] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'library'
    `;
    expect(Number(count)).toBeGreaterThan(20);
  });
});
