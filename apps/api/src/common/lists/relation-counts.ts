import type { TenantTx } from '@skoolos/db';

/**
 * Tenant-scoped replacements for Prisma's relation `_count`.
 *
 * `include: { _count: { select: { students: true } } }` reads like a scoped
 * count. It is not. Prisma compiles it to a LEFT JOIN over a subquery whose
 * WHERE clause is literally `1=1`:
 *
 *     LEFT JOIN (SELECT "classSectionId", COUNT(*)
 *                FROM "Student" WHERE 1=1
 *                GROUP BY "classSectionId") ...
 *
 * — the ENTIRE table is aggregated and the join throws away everything that
 * belongs to another school. The answer is right; the cost is proportional to
 * the whole platform instead of to one school's data, so every school gets
 * slower as unrelated schools are added. It is the same failure as an
 * unscoped `findMany`, wearing a `_count` where the missing `schoolId` cannot
 * be seen, and RLS cannot rescue it: the policy's `("schoolId")::text` cast
 * makes the tenant predicate a post-scan filter, never an index seek.
 *
 * There is no way to push a predicate into that generated subquery through
 * Prisma's API — `_count` takes a `where` on the RELATION, not on the parent.
 * So these helpers run the aggregate explicitly, scoped and index-backed.
 *
 * Measured on the 200-school bench, 2026-08-29 (9M attendance, 1M messages):
 *
 *   | site                          | Prisma's `_count` |  scoped |
 *   |-------------------------------|------------------:|--------:|
 *   | unread messages per thread    |          2,432 ms | 1.77 ms |
 *   | students per class section    |             27 ms | 0.19 ms |
 *   | active students per section   |             41 ms | 0.37 ms |
 *
 * Each returns a Map keyed by the grouping id, with absent keys meaning zero —
 * a `groupBy` emits no row for a section with no students, and callers must
 * read that as 0 rather than as missing.
 */

/** Rows a `groupBy` returns: the grouped key plus its tally. */
type Tally<K extends string> = ({ [P in K]: string | null } & { _count: { _all: number } })[];

function toMap<K extends string>(rows: Tally<K>, key: K): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const id = row[key];
    if (id) out.set(id, row._count._all);
  }
  return out;
}

/**
 * Students per class section.
 *
 * Seeks on `Student(schoolId, classSectionId)` — the index already existed;
 * only the leading `schoolId` was missing from the query.
 */
export async function studentCountsBySection(
  tx: TenantTx,
  schoolId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<Map<string, number>> {
  const rows = await tx.student.groupBy({
    by: ['classSectionId'],
    where: { schoolId, ...(opts.activeOnly ? { isActive: true } : {}) },
    _count: { _all: true },
  });
  return toMap(rows as Tally<'classSectionId'>, 'classSectionId');
}

/**
 * Unread messages per thread, counting only what the OTHER party sent.
 *
 * The worst of the set: `Message` holds every message every school has ever
 * sent, so Prisma's version seq-scanned a million rows to render one school's
 * inbox. Seeks on `Message(schoolId, senderRole, readAt)`.
 */
export async function unreadCountsByThread(
  tx: TenantTx,
  schoolId: string,
  senderRole: string,
): Promise<Map<string, number>> {
  const rows = await tx.message.groupBy({
    by: ['threadId'],
    where: { schoolId, senderRole, readAt: null },
    _count: { _all: true },
  });
  return toMap(rows as Tally<'threadId'>, 'threadId');
}

/** Seating plans per room. Seeks on `SeatingPlan(schoolId, roomId)`. */
export async function seatingPlanCountsByRoom(
  tx: TenantTx,
  schoolId: string,
): Promise<Map<string, number>> {
  const rows = await tx.seatingPlan.groupBy({
    by: ['roomId'],
    where: { schoolId },
    _count: { _all: true },
  });
  return toMap(rows as Tally<'roomId'>, 'roomId');
}

/**
 * How many students have opened each assignment.
 *
 * Narrowed to one section's assignments as well as one school: a teacher
 * opening 4B should not aggregate the receipts of every assignment the school
 * has ever set. Seeks on `AssignmentSeen(schoolId, assignmentId)`.
 */
export async function seenCountsByAssignment(
  tx: TenantTx,
  schoolId: string,
  assignmentIds: string[],
): Promise<Map<string, number>> {
  if (assignmentIds.length === 0) return new Map();
  const rows = await tx.assignmentSeen.groupBy({
    by: ['assignmentId'],
    where: { schoolId, assignmentId: { in: assignmentIds } },
    _count: { _all: true },
  });
  return toMap(rows as Tally<'assignmentId'>, 'assignmentId');
}
