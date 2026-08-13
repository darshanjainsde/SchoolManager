-- Lost books: the report, and the provenance of every rupee it produces.
--
-- P3 is the first time this service produces a number a parent is asked to pay.
-- Everything unusual in this migration exists to make that number defensible:
-- where it came from, who chose it, and the fact that it cannot move afterwards.

-- ---------------------------------------------------------------- enums
--
-- FineAmountSource deliberately has no UNPRICED member, even though the
-- resolver (apps/library-api/src/common/replacement-price.ts) returns one. An
-- unpriced loss creates NO fine at all — a ₹0 fine reads as "nothing owed" to
-- every total and to P5's No Dues certificate — so the value could never appear
-- on a row here.
CREATE TYPE "FineAmountSource" AS ENUM ('TYPED', 'TITLE_PRICE', 'PURCHASE_COST');

CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'OTHER');

-- BOOK_FOUND and REPLACED_IN_KIND are MECHANICAL: the school lost nothing, so
-- the collections dashboard must exclude them from the "let off" money figure.
-- A code rather than free text because four hundred unique strings cannot
-- answer "where did each rupee go".
CREATE TYPE "WaiverReason" AS ENUM (
  'BOOK_FOUND', 'REPLACED_IN_KIND', 'WRITTEN_OFF_UNREPLACEABLE',
  'HARDSHIP', 'LIBRARY_ERROR', 'GOODWILL'
);

-- Every value is set by a USER ACTION, never by a clock (trap 7). Nothing here
-- is time-derived, so schema-shape.spec.ts needs no new exception entry.
CREATE TYPE "LostReportStatus" AS ENUM (
  'REPORTED', 'CONFIRMED', 'REJECTED',
  'SETTLED_PAID', 'SETTLED_IN_KIND', 'WRITTEN_OFF', 'FOUND'
);

-- ---------------------------------------------------------------- LostReport
CREATE TABLE "LostReport" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orgId"             UUID NOT NULL,
  "copyId"            UUID NOT NULL,
  "branchId"          UUID NOT NULL,
  -- Both NULL together for a loss found at stock verification: nobody had it.
  "memberId"          UUID,
  "issueId"           UUID,
  "reportedByUserId"  UUID,
  "selfReported"      BOOLEAN NOT NULL DEFAULT false,
  "reportedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"            "LostReportStatus" NOT NULL,
  "confirmedAt"       TIMESTAMP(3),
  "confirmedByUserId" UUID,
  "rejectedReason"    TEXT,
  "frozenLateAmount"  DECIMAL(10,2),
  "replacementAmount" DECIMAL(10,2),
  "priceSource"       "FineAmountSource",
  "settledAt"         TIMESTAMP(3),
  "settledByUserId"   UUID,
  "approvedByNote"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LostReport_orgId_fkey"    FOREIGN KEY ("orgId")    REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Restrict on everything carrying history: a copy, a branch, a member or an
  -- issue with a loss on its record must not vanish out from under it. Same
  -- reasoning as Issue.copy and Fine.member.
  CONSTRAINT "LostReport_copyId_fkey"   FOREIGN KEY ("copyId")   REFERENCES "Copy"("id")    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LostReport_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id")  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LostReport_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id")  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LostReport_issueId_fkey"  FOREIGN KEY ("issueId")  REFERENCES "Issue"("id")   ON DELETE RESTRICT ON UPDATE CASCADE,
  -- SetNull for the people: a departed librarian must not block user deletion,
  -- and the report itself survives without them.
  CONSTRAINT "LostReport_reportedByUserId_fkey"  FOREIGN KEY ("reportedByUserId")  REFERENCES "LibUser"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LostReport_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "LibUser"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LostReport_settledByUserId_fkey"   FOREIGN KEY ("settledByUserId")   REFERENCES "LibUser"("id") ON DELETE SET NULL ON UPDATE CASCADE,

  -- A stock-take loss has NO member and NO issue; every other loss has BOTH.
  -- Enforced here rather than in the handler so it is impossible to record a
  -- missing book against a child who never had it, by any route including a
  -- future admin script.
  CONSTRAINT "LostReport_member_and_issue_together"
    CHECK (("memberId" IS NULL) = ("issueId" IS NULL)),

  -- A child can only self-report a book they are holding, so a self-report
  -- always has a member. Without this, `selfReported` could be set on a
  -- stock-take row and the confirm flow would have nobody to bill.
  CONSTRAINT "LostReport_self_report_has_member"
    CHECK (NOT "selfReported" OR "memberId" IS NOT NULL),

  -- Money is never negative. Same reasoning as
  -- Title_replacementPrice_nonnegative: a negative here would CREDIT a parent
  -- for losing a book, and no path should be able to produce one.
  CONSTRAINT "LostReport_frozenLate_nonnegative"
    CHECK ("frozenLateAmount" IS NULL OR "frozenLateAmount" >= 0),
  CONSTRAINT "LostReport_replacement_nonnegative"
    CHECK ("replacementAmount" IS NULL OR "replacementAmount" >= 0),

  -- An amount and its provenance are one fact. A price with no source could not
  -- be explained to a parent asking "who decided ₹299", and a source with no
  -- price describes nothing.
  CONSTRAINT "LostReport_price_has_source"
    CHECK (("replacementAmount" IS NULL) = ("priceSource" IS NULL))
);

-- ONE open report per copy. Two clerks reporting the same book at the same
-- moment: the loser gets a 409 from the database. Constraints do not race;
-- application check-then-write does (trap 3) — the same guarantee, and the same
-- shape, as issue_one_active_per_copy.
--
-- Scoped to the OPEN statuses only, which is what lets a book be lost, found,
-- and lost again years later: FOUND/REJECTED/SETTLED_*/WRITTEN_OFF are terminal
-- and drop out of the index, freeing the copy for a new report.
CREATE UNIQUE INDEX "lost_report_one_open_per_copy"
  ON "LostReport" ("copyId") WHERE "status" IN ('REPORTED', 'CONFIRMED');

CREATE INDEX "LostReport_orgId_idx"                ON "LostReport"("orgId");
CREATE INDEX "LostReport_orgId_branchId_status_idx" ON "LostReport"("orgId", "branchId", "status");
CREATE INDEX "LostReport_orgId_memberId_idx"       ON "LostReport"("orgId", "memberId");

-- EVERY foreign key column gets its own single-column index, and this is not
-- housekeeping — it was measured. Postgres has to check each referencing row
-- when a PARENT row is deleted, and a composite index led by `orgId` cannot
-- serve a lookup by `copyId` alone, so without these each delete of a Copy,
-- Member, Issue, Branch or LibUser sequentially scans this whole table.
--
-- The first version of this migration had only the three indexes above. The
-- e2e suite, which creates and tears down orgs constantly, went from 17s to
-- 823s on the authz-matrix suite alone — a 48x regression that turned a green
-- gate red. Cheap to add here, invisible and expensive to diagnose later on a
-- school's real data.
CREATE INDEX "LostReport_copyId_idx"            ON "LostReport"("copyId");
CREATE INDEX "LostReport_issueId_idx"           ON "LostReport"("issueId");
CREATE INDEX "LostReport_memberId_idx"          ON "LostReport"("memberId");
CREATE INDEX "LostReport_branchId_idx"          ON "LostReport"("branchId");
CREATE INDEX "LostReport_reportedByUserId_idx"  ON "LostReport"("reportedByUserId");
CREATE INDEX "LostReport_confirmedByUserId_idx" ON "LostReport"("confirmedByUserId");
CREATE INDEX "LostReport_settledByUserId_idx"   ON "LostReport"("settledByUserId");

-- ---------------------------------------------------------------- Fine
-- The snapshot. Never a live join back to Title.replacementPrice: the bill
-- handed to a parent in August must still read the same next March, even after
-- someone edits that book's price in the catalogue.
ALTER TABLE "Fine" ADD COLUMN "amountSource"      "FineAmountSource";
-- Set ONLY when amountSource is TYPED. For TITLE_PRICE/PURCHASE_COST nobody
-- typed anything, and naming a person there would be a lie an auditor could
-- read. "Which librarian ran the flow" is LostReport.confirmedByUserId.
ALTER TABLE "Fine" ADD COLUMN "amountSetByUserId" UUID;
-- No amountSetAt: the amount is fixed when the row is created and never edited,
-- so createdAt already IS that timestamp and a second column could only disagree.

ALTER TABLE "Fine" ADD COLUMN "paidAt"       TIMESTAMP(3);
ALTER TABLE "Fine" ADD COLUMN "paidByUserId" UUID;
ALTER TABLE "Fine" ADD COLUMN "paidMethod"   "PaymentMethod";
ALTER TABLE "Fine" ADD COLUMN "paymentNote"  TEXT;

ALTER TABLE "Fine" ADD COLUMN "waiverReasonCode" "WaiverReason";

ALTER TABLE "Fine"
  ADD CONSTRAINT "Fine_amountSetByUserId_fkey" FOREIGN KEY ("amountSetByUserId")
    REFERENCES "LibUser"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Fine_paidByUserId_fkey" FOREIGN KEY ("paidByUserId")
    REFERENCES "LibUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Only a TYPED amount may name the person who chose it. This is the constraint
-- that keeps the provenance answer honest under every future code path.
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_amount_typed_has_author"
  CHECK ("amountSetByUserId" IS NULL OR "amountSource" = 'TYPED');

-- Same unindexed-foreign-key reasoning as LostReport above: deleting a LibUser
-- must not sequentially scan every fine the school has ever raised.
CREATE INDEX "Fine_amountSetByUserId_idx" ON "Fine"("amountSetByUserId");
CREATE INDEX "Fine_paidByUserId_idx"      ON "Fine"("paidByUserId");

-- ---------------------------------------------------------------- RLS
-- Same fail-closed shape as every other table (20260811190300_circulation_rls):
-- NULLIF(current_setting(...), '') before the ::uuid cast, because a pooled
-- connection that has already served a scoped request reads back '' rather than
-- NULL, and ''::uuid raises instead of failing closed (trap 1).
--
-- LostReport carries its own orgId, so this scopes DIRECTLY on app.current_org
-- and needs no RLS_ALLOW_LIST entry — the coverage audit will pick it up as a
-- normal tenant table.
ALTER TABLE "LostReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LostReport" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "LostReport"
  USING ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA library TO library_app, library_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA library TO library_app, library_platform;
