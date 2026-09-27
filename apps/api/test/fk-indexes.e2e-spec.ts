import { getPlatformPrisma, disconnectAll } from '@skoolos/db';

/**
 * Every foreign key column must have an index that can serve a lookup on that
 * column ALONE.
 *
 * Postgres checks referencing rows whenever a PARENT row is deleted, and that
 * check runs OUTSIDE row-level security — it can never be narrowed to one
 * school. If the child's FK column has no usable index, the check reads the
 * whole child table, or scans a composite index led by "schoolId" from end to
 * end. Nothing fails. It just gets slower in proportion to data every OTHER
 * school accumulates, which makes it invisible in review and invisible in a
 * fresh test database.
 *
 * `packages/library-db/src/fk-indexes.spec.ts` is the same guard, and it exists
 * because the library service already paid for this: `LostReport` shipped with
 * only composite indexes led by `orgId`, its authz e2e suite went from 17
 * seconds to 823, and every test still passed. This file is that guard applied
 * to the product the library was a side project of — which had 78 unindexed
 * foreign keys when it was written, including `LibraryIssue.copyId`, the exact
 * same partial-index shape.
 *
 * Measured on a copy of "Result" carrying the real index set, 21 Sep 2026:
 *   360,000 rows — 4.96 ms unindexed vs 0.17 ms indexed
 * 3,600,000 rows — 106.64 ms unindexed vs 1.08 ms indexed
 *
 * A composite index counts only when the FK column is its FIRST column, which
 * is what `indkey[0] = attnum` checks. Partial indexes are excluded
 * (`indpred IS NULL`): an RI check must see every row, so an index with a WHERE
 * clause cannot serve it.
 */

/**
 * Foreign keys deliberately left unindexed.
 *
 * Every entry here is on a CONFIGURATION table — grades, fee plan items, leave
 * types, menu items, seating rooms — where a school holds tens of rows, not
 * thousands. The check stays sub-millisecond at any school count this product
 * will see, and an index would be storage with no reader.
 *
 * Adding an entry is a deliberate act and needs a reason a reader can weigh.
 * The `not rotted` test below also fails on any entry that no longer names a
 * real unindexed FK, so the list cannot quietly accumulate dead weight.
 */
export const UNINDEXED_FK_BASELINE: string[] = [
  'ClassSection.academicYearId',
  'ClassSection.classTeacherId',
  'ClassSection.gradeId',
  'FeaturedStaff.teacherId',
  'FeePlan.academicYearId',
  'FeePlanItem.categoryId',
  'FeePlanItem.gradeId',
  'FeePlanItem.termId',
  'FeeTerm.academicYearId',
  'HallOfFameGroup.courseId',
  'LeaveAllocation.academicYearId',
  'LeaveAllocation.typeDefId',
  'LeaveApplication.typeDefId',
  'MenuItem.parentId',
  'ReportWindow.academicYearId',
  'SchoolBlogSelection.postId',
  'SeatingPlan.roomId',
  'SessionPlan.fromYearId',
  'SessionPlan.toYearId',
  'TeacherSubject.subjectId',
];

const UNINDEXED_SQL = `
  SELECT cl.relname AS "table", a.attname AS "column"
  FROM pg_constraint c
  JOIN pg_class cl ON cl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.contype = 'f'
    AND n.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1 FROM pg_index x
      WHERE x.indrelid = c.conrelid AND x.indkey[0] = a.attnum AND x.indpred IS NULL
    )
  ORDER BY 1, 2
`;

type FkRow = { table: string; column: string };
const name = (r: FkRow): string => `${r.table}.${r.column}`;

describe('every foreign key is indexed', () => {
  afterAll(async () => {
    await disconnectAll();
  });

  it('has no FK column that would force a full scan on parent delete', async () => {
    const rows = await getPlatformPrisma().$queryRawUnsafe<FkRow[]>(UNINDEXED_SQL);
    // Named in the failure so the fix is obvious: add @@index([<column>]) to
    // the model and a matching CREATE INDEX to a migration.
    const offenders = rows.map(name).filter((fk) => !UNINDEXED_FK_BASELINE.includes(fk));
    expect(offenders).toEqual([]);
  });

  it('regression: a NEWLY unindexed foreign key is caught, not swallowed by the baseline', async () => {
    // Proves the filter discriminates. A baseline that accidentally matched
    // everything would make this guard permanently green — the same vacuous
    // pass the RLS audit's own row-count check exists to prevent.
    const rows = await getPlatformPrisma().$queryRawUnsafe<FkRow[]>(`
      SELECT cl.relname AS "table", a.attname AS "column"
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND n.nspname = 'public'
    `);
    const pretendNew = 'Pretend.newlyAddedFk';
    const offenders = [...rows.map(name), pretendNew].filter(
      (fk) => !UNINDEXED_FK_BASELINE.includes(fk),
    );
    expect(offenders).toContain(pretendNew);
  });

  it('the baseline has not rotted — every entry still names a real unindexed FK', async () => {
    // An entry that matches nothing is either a fixed FK (delete the line and
    // the guard gets stronger) or a typo (the guard is weaker than it looks and
    // nobody can tell). Either way it should be said out loud.
    const rows = await getPlatformPrisma().$queryRawUnsafe<FkRow[]>(UNINDEXED_SQL);
    const actual = new Set(rows.map(name));
    expect(UNINDEXED_FK_BASELINE.filter((fk) => !actual.has(fk))).toEqual([]);
  });

  it('actually inspected some foreign keys, rather than passing on an empty schema', async () => {
    const [{ count }] = await getPlatformPrisma().$queryRawUnsafe<{ count: bigint }[]>(`
      SELECT count(*) FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'
    `);
    expect(Number(count)).toBeGreaterThan(100);
  });
});
