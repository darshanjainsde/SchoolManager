/**
 * Row ceilings for tenant list queries.
 *
 * A Vercel Function's response body is capped at 4.5 MB; past it the platform
 * returns 413 and the caller sees an error, not a slow page. Measured on the
 * seeded database, GET /manage/students returned 227 KB for 500 students — so
 * a school around 10,000 students would break the page with no code change at
 * all, just growth.
 *
 * These are GUARDS, not pagination. Each is set well above what the query can
 * legitimately return, so no existing screen changes behaviour, while the
 * payload can never reach the platform cap. Two things make that safe:
 *
 *   - the ceiling is sized per growth class, below;
 *   - hitting one is reported, never silent. `packages/db` warns whenever a
 *     findMany returns exactly its take, which is the signature of a truncated
 *     read. Hidden truncation is worse than the unbounded query it replaced.
 */
export const LIST_CEILING = {
  /**
   * Fixed by how a school is organised, not by how long it has been running:
   * grades, periods, subjects, class sections, rooms, leave types. A school
   * with 500 of any of these has a data-entry problem, not a scale problem.
   */
  STRUCTURE: 500,

  /**
   * People on the roll — students, teachers, staff, alumni. India's largest
   * schools run to a few thousand students; alumni accumulate for decades,
   * which is why this sits well above the roster itself.
   */
  ROSTER: 20_000,

  /**
   * Things that happen — attendance, messages, results, diary, library loans.
   * These are always already scoped to a class, a date or a person, so the
   * ceiling exists only to stop an unscoped call becoming a whole-table read.
   */
  ACTIVITY: 2_000,
} as const;

export type ListCeiling = (typeof LIST_CEILING)[keyof typeof LIST_CEILING];
