-- Phase 1a review finding: catalogue enforces branch scope (guard + service),
-- circulation enforced none. An ASSISTANT scoped to branch A could issue,
-- return and renew any branch-B copy, and /circulation/holds, /fines,
-- /overdue, /day-report all returned org-wide data. This migration adds the
-- columns that make "which branch is this at" answerable at all; the app-side
-- enforcement (BranchScopeGuard + service-level checks against the LOADED
-- row's own branch) lands in the same commit as this migration.

-- ---------------------------------------------------------------------------
-- Loan.branchId — NOT NULL, denormalized from Copy.branchId at issue time.
-- Added nullable first because Postgres cannot add a NOT NULL column to a
-- non-empty table without either a DEFAULT or this two-step backfill; there
-- is no sane constant default for "which branch was this loan issued at".
-- ---------------------------------------------------------------------------
ALTER TABLE "Loan" ADD COLUMN "branchId" UUID;

-- Total backfill: every existing Loan row has a copyId, and every Copy has a
-- branchId, so no row is left unset before the NOT NULL below is applied.
UPDATE "Loan" l SET "branchId" = c."branchId" FROM "Copy" c WHERE c."id" = l."copyId";

ALTER TABLE "Loan" ALTER COLUMN "branchId" SET NOT NULL;
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Loan_orgId_branchId_idx" ON "Loan"("orgId", "branchId");

-- ---------------------------------------------------------------------------
-- Hold.branchId — nullable. Only set once a hold is PROMOTED onto a specific
-- copy (readyCopyId): a still-PENDING hold is a place in line for a Title,
-- fillable by any branch's copy, so it has no branch yet. Existing
-- PENDING/CANCELLED/EXPIRED holds with no readyCopyId backfill to NULL (there
-- is no copy to derive a branch from); existing READY/COLLECTED holds
-- backfill from their readyCopy.
-- ---------------------------------------------------------------------------
ALTER TABLE "Hold" ADD COLUMN "branchId" UUID;
UPDATE "Hold" h SET "branchId" = c."branchId"
  FROM "Copy" c
  WHERE c."id" = h."readyCopyId" AND h."readyCopyId" IS NOT NULL;

ALTER TABLE "Hold" ADD CONSTRAINT "Hold_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Hold_orgId_branchId_idx" ON "Hold"("orgId", "branchId");

-- ---------------------------------------------------------------------------
-- CirculationPolicy.branchId — nullable = org default. Every existing row
-- has no branchId column at all yet, so adding it nullable and leaving every
-- existing row NULL is *already* "preserve existing rows as org defaults" —
-- no backfill UPDATE needed, only the column add.
--
-- Replaces the old (orgId, memberType) unique — one policy per org — with
-- the branch-aware shape. Deliberately NOT a single
-- `UNIQUE (orgId, branchId, memberType)`: Postgres unique indexes treat NULL
-- as distinct from NULL, so a plain unique constraint on a nullable branchId
-- would silently allow two org-default (branchId NULL) rows for the same
-- memberType to coexist — the same NULL-is-not-equal-to-NULL gotcha this
-- project already works around for RLS (NULLIF, LIBRARY-TRAPS.md #1). Two
-- partial unique indexes close that gap precisely, the same technique
-- `loan_one_active_per_copy` (20260811190200_circulation) already uses for a
-- different NULL-bearing column:
--   - branch-specific rows: unique per (orgId, branchId, memberType) among
--     rows where branchId IS NOT NULL.
--   - org-default rows: unique per (orgId, memberType) among rows where
--     branchId IS NULL — i.e. at most one org default per memberType.
-- ---------------------------------------------------------------------------
ALTER TABLE "CirculationPolicy" ADD COLUMN "branchId" UUID;
DROP INDEX "CirculationPolicy_orgId_memberType_key";

ALTER TABLE "CirculationPolicy" ADD CONSTRAINT "CirculationPolicy_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "circulation_policy_branch_unique"
  ON "CirculationPolicy" ("orgId", "branchId", "memberType") WHERE "branchId" IS NOT NULL;
CREATE UNIQUE INDEX "circulation_policy_org_default_unique"
  ON "CirculationPolicy" ("orgId", "memberType") WHERE "branchId" IS NULL;

CREATE INDEX "CirculationPolicy_orgId_branchId_memberType_idx" ON "CirculationPolicy"("orgId", "branchId", "memberType");
