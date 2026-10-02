import { Prisma } from '@skoolos/db';
import {
  BUCKETS, BUCKET_OF, DATA_BUCKETS, KEPT_BUCKETS, SPLITS,
  bucketRank, bucketsOfModel, rowFilter, topBucketOfModel,
} from './buckets';
import { EXCLUDED_MODELS, buildSchemaPlan } from './schema-plan';

const models = Prisma.dmmf.datamodel.models;
const plan = buildSchemaPlan();
const schoolModels = plan.insertOrder.map((p) => p.model);

/** The lowest bucket a model's rows can be in — the conservative side for a child. */
const bottom = (model: string) =>
  bucketsOfModel(model).reduce((a, b) => (bucketRank(b) < bucketRank(a) ? b : a));

describe('every school table belongs to exactly one bucket', () => {
  it('classifies every model the backup carries — a new table cannot fall out of a bucket', () => {
    const unplaced = schoolModels.filter((m) => bucketsOfModel(m).length === 0);
    expect(unplaced).toEqual([]);
  });

  it('classifies nothing that is not school data', () => {
    const real = new Set(schoolModels);
    const strangers = Object.keys(BUCKET_OF).filter((m) => !real.has(m));
    expect(strangers).toEqual([]);
  });

  it('never classifies an excluded credential', () => {
    for (const name of Object.keys(EXCLUDED_MODELS)) expect(bucketsOfModel(name)).toEqual([]);
  });

  it('splits the four buckets into the half that is kept and the half that is swapped', () => {
    expect([...KEPT_BUCKETS, ...DATA_BUCKETS].sort()).toEqual([...BUCKETS].sort());
  });

  it('keeps the whole schema covered, bucket by bucket', () => {
    const counts = Object.fromEntries(
      BUCKETS.map((b) => [b, schoolModels.filter((m) => bucketsOfModel(m).includes(b)).length]),
    );
    // Totals are reported so a reclassification is visible in the diff, not asserted
    // to the unit — only that nothing is empty and that `day` is the bulk of it.
    for (const b of BUCKETS) expect(counts[b]).toBeGreaterThan(0);
    expect(counts.day).toBeGreaterThan(counts.school + counts.website + counts.setup);
    expect(schoolModels.length).toBeGreaterThan(140);
  });
});

describe('a split table partitions its rows, never duplicates or loses them', () => {
  it('names a real model, and both of its sides are real buckets', () => {
    const real = new Set(schoolModels);
    for (const [model, rule] of Object.entries(SPLITS)) {
      expect(real.has(model)).toBe(true);
      expect(BUCKETS).toContain(rule.then);
      expect(BUCKETS).toContain(rule.otherwise);
      expect(rule.then).not.toBe(rule.otherwise);
      expect(rule.because.length).toBeGreaterThan(20);
    }
  });

  it('selects one side by its predicate and the other by the exact negation', () => {
    expect(rowFilter('User', 'school')).toBe(`"role" IN ('OWNER', 'SCHOOL_ADMIN')`);
    expect(rowFilter('User', 'setup')).toBe(`NOT ("role" IN ('OWNER', 'SCHOOL_ADMIN'))`);
    expect(rowFilter('User', 'website')).toBeNull();
    expect(rowFilter('User', 'day')).toBeNull();
  });

  it('selects a whole table for its own bucket and nothing for any other', () => {
    expect(rowFilter('Student', 'setup')).toBe('');
    expect(rowFilter('Student', 'day')).toBeNull();
    expect(rowFilter('Attendance', 'day')).toBe('');
  });

  it('splits only on a column that cannot be null, so the negation is total', () => {
    for (const model of Object.keys(SPLITS)) {
      const m = models.find((x) => x.name === model)!;
      const columns = [...SPLITS[model].when.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((x) => x[1]);
      expect(columns.length).toBeGreaterThan(0);
      for (const c of columns) {
        const f = m.fields.find((x) => x.name === c);
        expect([model, c, f?.isRequired]).toEqual([model, c, true]);
      }
    }
  });
});

describe('required links point down, which is what makes one bucket restorable alone', () => {
  /**
   * A row may require a row in its own bucket or in a lower one. If a `setup`
   * row required a `day` row, emptying `day` would strand it — and restoring
   * `setup` alone could never succeed. Every violation is a classification bug,
   * so the failure names the pair rather than a count.
   */
  it('has no required foreign key from a lower bucket to a higher one', () => {
    const violations: string[] = [];
    for (const p of plan.insertOrder) {
      const childBucket = bottom(p.model);
      for (const fk of p.fks) {
        if (fk.nullable) continue;
        const parentBucket = topBucketOfModel(fk.refModel);
        if (!parentBucket) continue; // points at a platform or excluded model
        if (bucketRank(parentBucket) > bucketRank(childBucket)) {
          violations.push(
            `${p.model} (${childBucket}) requires ${fk.refModel} (${parentBucket}) via ${fk.columns.join(',')}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('has no RESTRICT link from a lower bucket into a higher one, so a scoped purge is never blocked from outside', () => {
    const violations: string[] = [];
    for (const [parentTable, links] of plan.inboundRestricts) {
      const parent = plan.insertOrder.find((p) => p.table === parentTable);
      if (!parent) continue;
      const parentBucket = bottom(parent.model);
      for (const link of links) {
        const child = plan.insertOrder.find((p) => p.table === link.childTable);
        if (!child) continue; // a platform table; the full purge clears those
        const childBucket = topBucketOfModel(child.model)!;
        if (bucketRank(childBucket) < bucketRank(parentBucket)) {
          violations.push(
            `${link.childTable} (${childBucket}) blocks a delete of ${parentTable} (${parentBucket}) via ${link.childColumns.join(',')}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps the pairs the design depends on in the buckets the design names', () => {
    const at = (m: string) => topBucketOfModel(m);
    expect(at('SchoolProfile')).toBe('website');
    expect(at('Student')).toBe('setup');
    expect(at('FeeCategory')).toBe('setup');
    expect(at('FeeInvoice')).toBe('day');
    expect(at('Exam')).toBe('day');
    expect(at('Result')).toBe('day');
    expect(at('FeeCounter')).toBe('day');
    expect(at('SchoolPaymentConfig')).toBe('school');
  });
});
