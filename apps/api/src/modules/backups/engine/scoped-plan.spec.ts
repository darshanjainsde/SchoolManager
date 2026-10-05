import { buildSchemaPlan } from './schema-plan';
import { expandScope, keptPointers, scopePlan } from './scoped-plan';

const plan = buildSchemaPlan();

describe('a scope is widened until emptying it strands nothing', () => {
  it('leaves `day` alone — nothing outside it depends on what happened', () => {
    expect(expandScope(plan, ['day'])).toEqual(['day']);
  });

  it('takes `day` along with `setup` — 42 required links cascade off the roster', () => {
    expect(expandScope(plan, ['setup'])).toEqual(['setup', 'day']);
  });

  it('is already closed for the whole management half', () => {
    expect(expandScope(plan, ['setup', 'day'])).toEqual(['setup', 'day']);
  });

  it('leaves `website` alone — no row anywhere requires a page or a picture', () => {
    expect(expandScope(plan, ['website'])).toEqual(['website']);
  });

  it('shows why the `school` bucket is never emptied: its admin logins carry day rows', () => {
    // This is the test that justifies restoring `school` by key instead of by
    // emptying it. If it ever returns ['school'] alone, that restraint can go.
    expect(expandScope(plan, ['school'])).toEqual(['school', 'day']);
  });
});

describe('pointers on kept rows that aim into a replaced bucket', () => {
  it('finds the two website columns that would be emptied with the roster', () => {
    const found = keptPointers(plan, ['setup', 'day']).map((p) => `${p.table}.${p.column}→${p.refTable}`).sort();
    expect(found).toEqual(['FeaturedStaff.teacherId→Teacher', 'HallOfFameEntry.studentId→Student']);
  });

  it('finds none for a day-only rollback', () => {
    expect(keptPointers(plan, ['day'])).toEqual([]);
  });
});

describe('a narrowed plan carries only its own tables', () => {
  const day = scopePlan(plan, ['day']);
  const web = scopePlan(plan, ['website']);
  const data = scopePlan(plan, ['setup', 'day']);

  it('keeps the tables of the bucket and none of the others', () => {
    expect(day.insertOrder.some((t) => t.model === 'Attendance')).toBe(true);
    expect(day.insertOrder.some((t) => t.model === 'Student')).toBe(false);
    expect(web.insertOrder.map((t) => t.model)).toContain('SchoolPage');
    expect(web.insertOrder.some((t) => t.model === 'Attendance')).toBe(false);
  });

  it('still inserts parents before children inside the scope', () => {
    const pos = new Map(data.insertOrder.map((t, i) => [t.model, i]));
    expect(pos.get('Student')! < pos.get('Attendance')!).toBe(true);
    expect(pos.get('FeeTerm')! < pos.get('FeeInvoice')!).toBe(true);
  });

  it('deletes children first inside the scope', () => {
    expect(data.deleteOrder.map((t) => t.model)).toEqual([...data.insertOrder].reverse().map((t) => t.model));
  });

  it('selects a whole table, a split half, or nothing at all', () => {
    expect(day.where('Attendance')).toBe('');
    expect(day.where('Student')).toBeNull();
    expect(scopePlan(plan, ['setup']).where('User')).toBe(`NOT ("role" IN ('OWNER', 'SCHOOL_ADMIN'))`);
    expect(scopePlan(plan, ['school']).where('User')).toBe(`"role" IN ('OWNER', 'SCHOOL_ADMIN')`);
  });

  it('moves a split table whole when both of its halves are in scope', () => {
    expect(scopePlan(plan, ['school', 'website', 'setup', 'day']).where('User')).toBe('');
  });

  it('never reaches the excluded credential tables', () => {
    expect(day.excludedTables).toEqual([]);
    expect(plan.excludedTables.length).toBeGreaterThan(0);
  });

  it('keeps only the blocking links that point at a table it will delete', () => {
    expect(data.inboundRestricts.has('FeeTerm')).toBe(true);
    expect(web.inboundRestricts.has('FeeTerm')).toBe(false);
  });

  it('takes exactly the buckets it is given, and says whether they are safe to empty', () => {
    expect(scopePlan(plan, ['setup']).buckets).toEqual(['setup']);
    expect(scopePlan(plan, ['setup']).closed).toBe(false);
    expect(scopePlan(plan, ['setup', 'day']).closed).toBe(true);
    expect(scopePlan(plan, ['day']).closed).toBe(true);
    expect(scopePlan(plan, ['website']).closed).toBe(true);
    expect(scopePlan(plan, ['school']).closed).toBe(false);
  });
});
