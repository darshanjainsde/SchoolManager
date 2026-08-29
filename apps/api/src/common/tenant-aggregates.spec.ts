import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Two ways to ask the database a question that quietly ignores the tenant.
 *
 * THE CONTROL THIS PROTECTS. Every RLS policy compares
 * `("schoolId")::text` against `current_setting('app.current_tenant')`. The
 * cast sits on the COLUMN side, so no uuid index can serve it: the tenant
 * predicate is always a post-scan Filter, never an Index Cond. RLS therefore
 * makes an unscoped query CORRECT and does nothing whatsoever for its cost —
 * the rows are read, then discarded. A query missing its `schoolId` returns
 * the right answer at a price that grows with the whole platform, so every
 * school gets slower as unrelated schools sign up, and no test can fail.
 *
 * Only cost tells you. That is why this is a source guard and not a test of
 * behaviour: there is no behaviour to assert on.
 *
 * WHY THESE TWO SHAPES. The August scoping pass fixed ~140 sites by searching
 * for a `where` that lacked `schoolId`. Eleven sites survived it, and were
 * found five weeks later only by re-measuring every endpoint — because they
 * have no `where` to inspect at all. Both shapes below are that: places where
 * the missing tenant predicate is invisible to a reviewer reading the diff.
 *
 *   1. A relation `_count` inside an include/select. Prisma compiles
 *      `include: { _count: { select: { students: true } } }` into a join over
 *      `SELECT "classSectionId", COUNT(*) FROM "Student" WHERE 1=1 GROUP BY 1`
 *      — the whole table, every school. The `where` accepted inside `_count`
 *      filters the RELATION, not the parent, so the tenant id CANNOT be
 *      pushed in through Prisma's API. It has to be written by hand.
 *      Measured 2026-08-29 on 1M messages: 2,432 ms as a parallel seq scan of
 *      every message on the platform, to draw ONE school's inbox. Rewritten as
 *      a scoped groupBy on a matching index: 1.77 ms.
 *
 *   2. `count()` / `aggregate()` / `groupBy()` called with NO arguments. Same
 *      failure, plainer: `libraryBookCopy.count()` totalled all 200,000 copies
 *      on the platform to show one school's shelf — 50 ms of that dashboard's
 *      66 ms of database time, growing with every school onboarded.
 *
 * Neither test judges whether a given call is correct; a test cannot. They
 * make writing one a DELIBERATE act — it fails until someone adds the file
 * below with a reason, which is the moment a reviewer gets to ask whether this
 * really should read every school's rows.
 *
 * THE FIX, when you hit this. Write the aggregate explicitly as a `groupBy`
 * whose `where` carries the tenant id, and stitch the result in application
 * code — rebuilding the same `_count` shape on the way out, so no response
 * contract changes. `common/lists/relation-counts.ts` holds the helpers.
 * Check the index exists before assuming the scoped version is fast: `Message`
 * had no index on `schoolId` at all.
 */

/** Files allowed a relation `_count`. Prefer to keep this empty. */
const RELATION_COUNT_ALLOWED: Record<string, string> = {};

/** Files allowed an argument-less aggregate, each genuinely cross-tenant. */
const BARE_AGGREGATE_ALLOWED: Record<string, string> = {
  'modules/owner/internal/owner-schools.service.ts':
    'the operator console counts schools across the platform — that IS the question',
};

const SRC = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments are blanked, not deleted, so line numbers still point at the file.
 *
 * Without this the guard reports `relation-counts.ts` — the very file written
 * to replace the bad shape, which necessarily quotes it in its documentation.
 * A guard that fires on prose about itself is one people learn to ignore.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => ' '.repeat(m.length));
}

function scan(pattern: RegExp, allowed: Record<string, string>): string[] {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/');
    if (rel in allowed) continue;
    const src = code(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(pattern)) {
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${rel}:${line}`);
    }
  }
  return offenders;
}

describe('tenant aggregates', () => {
  it('never asks Prisma for a relation _count', () => {
    // `_count: { select: ... }` is unambiguously the relation form. The other
    // spelling, `_count: { _all: true }` inside a groupBy or aggregate, is a
    // top-level aggregate that carries its own where and is fine.
    expect(scan(/_count:\s*\{\s*select\b/g, RELATION_COUNT_ALLOWED)).toEqual([]);
  });

  it('never calls count/aggregate/groupBy with no arguments', () => {
    expect(scan(/\.(?:count|aggregate|groupBy)\(\s*\)/g, BARE_AGGREGATE_ALLOWED)).toEqual([]);
  });
});
