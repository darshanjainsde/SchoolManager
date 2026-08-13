-- Two changes, both about calling things what a school librarian calls them.
--
-- 1. "Loan" is library-speak. A school issues a book. The model, its enum, its
--    relations and its indexes all move to that word so the API, the console,
--    the student app and the database agree on one vocabulary.
--
-- 2. The barcode is gone. Every Indian school library already writes a
--    permanent accession number inside the front cover by hand, and it is
--    unique per physical copy — exactly what `barcode` was for. Carrying both
--    meant reconciling two identifiers for one thing, and it forced a school to
--    buy scanner hardware to lend a book.
--
-- Everything here is a RENAME, never a drop-and-recreate: the tables hold real
-- rows on staging and the data must survive intact.

-- ---------------------------------------------------------------- 1. Issue
ALTER TYPE "LoanStatus" RENAME TO "IssueStatus";
ALTER TABLE "Loan" RENAME TO "Issue";

-- Constraint and index names follow the table, or a later `prisma migrate diff`
-- reports drift against a schema that expects the new names.
ALTER TABLE "Issue" RENAME CONSTRAINT "Loan_pkey"                TO "Issue_pkey";
ALTER TABLE "Issue" RENAME CONSTRAINT "Loan_orgId_fkey"          TO "Issue_orgId_fkey";
ALTER TABLE "Issue" RENAME CONSTRAINT "Loan_copyId_fkey"         TO "Issue_copyId_fkey";
ALTER TABLE "Issue" RENAME CONSTRAINT "Loan_branchId_fkey"       TO "Issue_branchId_fkey";
ALTER TABLE "Issue" RENAME CONSTRAINT "Loan_memberId_fkey"       TO "Issue_memberId_fkey";
ALTER TABLE "Issue" RENAME CONSTRAINT "Loan_issuedByUserId_fkey" TO "Issue_issuedByUserId_fkey";
ALTER TABLE "Issue" RENAME CONSTRAINT "Loan_returnedByUserId_fkey" TO "Issue_returnedByUserId_fkey";

ALTER INDEX "Loan_orgId_idx"           RENAME TO "Issue_orgId_idx";
ALTER INDEX "Loan_orgId_branchId_idx"  RENAME TO "Issue_orgId_branchId_idx";

-- The three partial indexes that carry real guarantees. `loan_one_active_per_copy`
-- is the one that makes it impossible for two people to hold the same copy at
-- once — it is renamed, never dropped, so that guarantee is continuous.
ALTER INDEX "loan_one_active_per_copy" RENAME TO "issue_one_active_per_copy";
ALTER INDEX "loan_due"                 RENAME TO "issue_due";
ALTER INDEX "loan_member_active"       RENAME TO "issue_member_active";

-- Fine points at an issue, not a loan.
ALTER TABLE "Fine" RENAME COLUMN "loanId" TO "issueId";
ALTER TABLE "Fine" RENAME CONSTRAINT "Fine_loanId_fkey" TO "Fine_issueId_fkey";

-- How long a book may be kept.
ALTER TABLE "CirculationPolicy" RENAME COLUMN "loanDays" TO "issueDays";

-- RLS policies are attached to the table and follow the rename automatically;
-- no policy needs recreating. Verified by the isolation e2e suite, which must
-- keep passing across this migration.

-- ------------------------------------------------------ 2. accession number
-- Backfill first: existing copies carry their identifier in `barcode` (the seed
-- wrote ACC-00001 style values), and accessionNumber is currently nullable.
UPDATE "Copy" SET "accessionNumber" = "barcode" WHERE "accessionNumber" IS NULL;

-- Any row still null here would fail the NOT NULL below and abort the whole
-- migration, which is the correct outcome: a copy with no number cannot be
-- lent, shelved or audited, and silently inventing one would corrupt the
-- register.
ALTER TABLE "Copy" ALTER COLUMN "accessionNumber" SET NOT NULL;

DROP INDEX IF EXISTS "Copy_orgId_barcode_key";
CREATE UNIQUE INDEX "Copy_orgId_accessionNumber_key" ON "Copy"("orgId", "accessionNumber");

ALTER TABLE "Copy" DROP COLUMN "barcode";
