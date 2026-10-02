import { Bucket, BUCKETS, bucketRank, bucketsOfModel, rowFilter, topBucketOfModel } from './buckets';
import { SchemaPlan, TablePlan } from './schema-plan';

/**
 * A SchemaPlan narrowed to some buckets — the whole of what "back up only the
 * website" or "roll back only today" means to the engine.
 *
 * Three things have to be true for a narrowed plan to be safe, and all three
 * are derived from the schema rather than remembered:
 *
 *  1. **The scope is closed under deletion.** Emptying a bucket deletes rows in
 *     any bucket that CASCADES from it, and clears rows that RESTRICT it, so a
 *     request for `setup` must take `day` with it. `expandScope` works that out
 *     (and `scope.spec.ts` pins today's answer, so a new foreign key that
 *     widens it shows up as a failing test rather than as lost data).
 *  2. **Rows kept outside the scope keep their pointers.** Two website columns
 *     point into `setup` and are SET NULL when it goes — a featured-staff card's
 *     teacher and a Hall of Fame entry's student. `keptPointers` lists them so
 *     the caller can note them before and put them back after.
 *  3. **A split table only moves its own half.** `where` carries the predicate
 *     that selects it.
 */
export interface ScopedPlan extends SchemaPlan {
  /** The buckets actually covered, after expansion. Always in restore order. */
  buckets: Bucket[];
  /** Exactly what was asked for, before expansion — for the message to the user. */
  requested: Bucket[];
  /**
   * SQL that selects this table's rows for this scope: `null` when the table
   * has no rows here, `''` for all of the school's rows, else a predicate over
   * the table's own columns. Written in `buckets.ts`, never by a caller.
   */
  where(model: string): string | null;
}

/** A pointer on a row we are KEEPING that points into a bucket being replaced. */
export interface KeptPointer {
  table: string;
  pk: string[];
  column: string;
  refTable: string;
}

const inScope = (model: string, buckets: readonly Bucket[]) =>
  bucketsOfModel(model).some((b) => buckets.includes(b));

/** The lowest bucket a model's rows can be in. */
const bottomBucket = (model: string): Bucket =>
  bucketsOfModel(model).reduce((a, b) => (bucketRank(b) < bucketRank(a) ? b : a));

/**
 * Widens a request until nothing outside it would be deleted by emptying it.
 *
 * A child row goes when its parent does if the link CASCADES, and a RESTRICT
 * link has to be cleared (which also deletes the child) before the parent can
 * go — so both pull their bucket in. SET NULL does not: that row survives with
 * an empty pointer, which is what `keptPointers` is for.
 */
export function expandScope(plan: SchemaPlan, requested: readonly Bucket[]): Bucket[] {
  const have = new Set<Bucket>(requested);
  for (;;) {
    let grew = false;
    for (const child of plan.insertOrder) {
      const childBucket = bottomBucket(child.model);
      if (have.has(childBucket)) continue;
      for (const fk of child.fks) {
        const deletesChild = fk.onDelete === 'Cascade' || fk.onDelete === 'Restrict' || fk.onDelete === 'NoAction';
        if (!deletesChild) continue;
        // ANY bucket the parent's rows can be in — a split table empties its
        // own half, and a child cascading off that half goes with it. Using the
        // parent's top bucket here would hide exactly that case (deleting the
        // admin logins in `school` takes their complaints in `day`).
        if (bucketsOfModel(fk.refModel).some((b) => have.has(b))) {
          have.add(childBucket);
          grew = true;
          break;
        }
      }
    }
    if (!grew) break;
  }
  return BUCKETS.filter((b) => have.has(b));
}

/**
 * Columns on rows OUTSIDE the scope that point INTO it, and that Postgres will
 * empty when the scope is emptied. The caller saves their values first and
 * writes back the ones whose target exists again — so restoring a school's own
 * `setup` keeps its featured-staff cards linked, while loading a sample pack
 * (whose teachers are different rows) correctly leaves them empty.
 */
export function keptPointers(plan: SchemaPlan, buckets: readonly Bucket[]): KeptPointer[] {
  const out: KeptPointer[] = [];
  for (const child of plan.insertOrder) {
    if (inScope(child.model, buckets)) continue;
    for (const fk of child.fks) {
      if (fk.onDelete !== 'SetNull' && fk.onDelete !== 'SetDefault') continue;
      if (fk.columns.length !== 1) continue;
      const parentBucket = topBucketOfModel(fk.refModel);
      if (!parentBucket || !buckets.includes(parentBucket)) continue;
      out.push({ table: child.table, pk: child.pk, column: fk.columns[0], refTable: fk.refTable });
    }
  }
  return out;
}

/**
 * Narrows a plan to a scope, expanding the scope first. Order is preserved, so
 * inserts still run parents-first and deletes children-first within the scope.
 */
export function scopePlan(
  plan: SchemaPlan,
  requested: readonly Bucket[],
  opts: {
    /**
     * Models to leave out even though their bucket is in scope. Used by sample
     * packs, where a few tables would reach outside the demo (a push token
     * would ring a real phone). Left out of the export AND of the load, so an
     * uploaded pack made elsewhere cannot smuggle one in.
     */
    exclude?: readonly string[];
  } = {},
): ScopedPlan {
  const buckets = expandScope(plan, requested);
  const excluded = new Set(opts.exclude ?? []);
  const keep = (t: TablePlan) => inScope(t.model, buckets) && !excluded.has(t.model);
  const insertOrder = plan.insertOrder.filter(keep);
  const tables = new Set(insertOrder.map((t) => t.table));
  const byModel = new Map([...plan.byModel].filter(([, t]) => keep(t)));
  // Only links into tables we are actually deleting can block us. A link from
  // a table outside the scope is still listed: it may be a platform table or
  // another school's row, which the normal walk never reaches.
  const inboundRestricts = new Map([...plan.inboundRestricts].filter(([table]) => tables.has(table)));
  return {
    ...plan,
    insertOrder,
    deleteOrder: [...insertOrder].reverse(),
    inboundRestricts,
    byModel,
    // Excluded credential tables are only swept by a WHOLE-school purge; a
    // scoped one must not reach them (no bucket claims them).
    excludedTables: [],
    buckets,
    requested: BUCKETS.filter((b) => requested.includes(b)),
    where: (model: string) => {
      for (const b of buckets) {
        const f = rowFilter(model, b);
        if (f !== null) {
          // A split table whose BOTH halves are in scope moves as a whole.
          const other = buckets.filter((x) => x !== b).map((x) => rowFilter(model, x));
          if (other.some((o) => o !== null)) return '';
          return f;
        }
      }
      return null;
    },
  };
}

/** Appends a scope's row filter to a WHERE clause. Returns '' when the table is whole. */
export const andFilter = (filter: string | null): string => (filter ? ` AND (${filter})` : '');

export const isScoped = (plan: SchemaPlan | ScopedPlan): plan is ScopedPlan =>
  Array.isArray((plan as ScopedPlan).buckets);

/** The buckets a plan covers, or null for a whole school. */
export const scopeOf = (plan: SchemaPlan | ScopedPlan): Bucket[] | null =>
  (isScoped(plan) ? plan.buckets : null);

/** The row filter for one model under a plan; a whole-school plan filters nothing. */
export const filterOf = (plan: SchemaPlan | ScopedPlan, model: string): string | null =>
  (isScoped(plan) ? plan.where(model) : '');
