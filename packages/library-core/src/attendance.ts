import type { LibraryTx } from '@library/db';

/**
 * How long an unclosed visit keeps absorbing transactions. A school period runs
 * 35-45 minutes; two hours is generous enough to cover a double period and a
 * late start, and short enough that a forgotten visit does not swallow the day.
 */
const VISIT_ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Mark a member present because they transacted — the by-product rule.
 *
 * ONE statement, and one that cannot fail. That is not an optimisation, it is
 * the only way this can be safe.
 *
 * The first version was four statements (settings lookup, a raw timezone query,
 * a findFirst, an upsert) documented as "best-effort ... returns quietly rather
 * than throwing". That was FALSE, and no try/catch could have made it true:
 * any Postgres error inside the caller's transaction puts that transaction into
 * aborted state (25P02), so every later statement and the COMMIT fail whatever
 * JavaScript catches — and Prisma has no savepoint API to scope it. Two
 * concrete failures it would have caused:
 *
 *   - a typo in LibraryOrg.timezone ('Asia/Calcuta') raises 22023, and then
 *     EVERY issue and EVERY return in that org 500s — attendance bookkeeping
 *     taking down lending, which is exactly backwards;
 *   - two rapid taps racing on VisitAttendance_one_per_member_visit, where the
 *     loser's unique violation rolls back a RETURN that already happened
 *     physically — the book is on the shelf and the database says it is out.
 *
 * `ON CONFLICT DO UPDATE` cannot raise a unique violation, and the whole thing
 * is a single round trip on a connection the transaction already owns. The
 * guards live in the WHERE clause rather than in JS:
 *
 *   - `closedAt IS NULL` and the two-hour window — a visit nobody closed must
 *     not absorb the rest of the day as "present in the library period";
 *   - `COALESCE(s."recordAttendance", true)` — settings may not exist yet;
 *   - the org's own timezone for "today", never the server's;
 *   - `branchId`, so one branch's "6-B" is not another's.
 *
 * If it matches nothing it writes nothing, which is the correct outcome for a
 * child who came outside a class period.
 *
 * Moved out of `periods.service.ts` alongside `issue`, its only caller, when
 * the circulation write paths moved into `@library/core` — that package
 * cannot import `apps/library-api`. `modules/periods/index.ts` re-exports it,
 * so the module's public interface is unchanged and there is still exactly
 * one implementation of "did this child visit the library".
 */
export async function markPresentByTransaction(
  tx: LibraryTx,
  orgId: string,
  memberId: string,
  classRef: string | null,
  branchId: string,
): Promise<void> {
  if (!classRef) return;

  await tx.$executeRaw`
    INSERT INTO "VisitAttendance" ("id", "orgId", "visitId", "memberId", "auto")
    SELECT gen_random_uuid(), v."orgId", v."id", ${memberId}::uuid, true
    FROM "ClassVisit" v
    JOIN "LibraryOrg" o ON o."id" = v."orgId"
    LEFT JOIN "LibrarySettings" s ON s."orgId" = v."orgId"
    WHERE v."orgId"    = ${orgId}::uuid
      AND v."branchId" = ${branchId}::uuid
      AND v."classRef" = ${classRef}
      AND v."closedAt" IS NULL
      AND v."openedAt" >= now() - make_interval(secs => ${VISIT_ACTIVE_WINDOW_MS / 1000})
      AND v."date"     = (now() AT TIME ZONE o."timezone")::date
      AND COALESCE(s."recordAttendance", true)
    ON CONFLICT ("visitId", "memberId")
      -- A transaction is stronger evidence than a ticked box, so it upgrades a
      -- hand mark to automatic and never the other way round.
      DO UPDATE SET "auto" = true
  `;
}
