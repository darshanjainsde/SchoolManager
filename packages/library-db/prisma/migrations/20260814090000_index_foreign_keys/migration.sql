-- Index every remaining foreign key.
--
-- Postgres checks referencing rows whenever a PARENT row is deleted. Without an
-- index on the child's FK column that check is a SEQUENTIAL SCAN of the whole
-- child table, once per deleted parent row. Nothing fails; it just gets slower
-- in proportion to the history a school accumulates — invisible in review,
-- invisible on a fresh database, and expensive exactly when a library has years
-- of data.
--
-- This is not theoretical here. The brand-new `LostReport` table shipped with
-- only composite indexes led by `orgId` (which cannot serve a lookup by
-- `copyId`), and the e2e authz-matrix suite went from 17 seconds to 823. The
-- guard added alongside that fix — packages/library-db/src/fk-indexes.spec.ts —
-- immediately reported these nineteen pre-existing offenders on the older
-- tables, and they were listed as a shrinking baseline rather than fixed inside
-- a lost-books migration.
--
-- This is that migration. Deleting an org cascades through Member, Copy, Issue,
-- Reservation and Fine, and `Issue.copyId`, `Issue.memberId` and `Fine.memberId`
-- are on the hottest of those paths.
--
-- Cost: each index is written on every insert/update of its table. Accepted
-- deliberately — circulation writes one row at a time at a counter, while the
-- deletes and the FK checks these serve are whole-cascade operations. The
-- baseline list in fk-indexes.spec.ts drops to empty with this, so any NEW
-- unindexed FK now fails the gate instead of being absorbed.

-- Catalogue
CREATE INDEX IF NOT EXISTS "Category_parentId_idx"  ON "Category"("parentId");
CREATE INDEX IF NOT EXISTS "Copy_branchId_idx"      ON "Copy"("branchId");

-- Circulation policy
CREATE INDEX IF NOT EXISTS "CirculationPolicy_branchId_idx" ON "CirculationPolicy"("branchId");

-- Issues — the hottest cascade path in the service.
CREATE INDEX IF NOT EXISTS "Issue_copyId_idx"           ON "Issue"("copyId");
CREATE INDEX IF NOT EXISTS "Issue_memberId_idx"         ON "Issue"("memberId");
CREATE INDEX IF NOT EXISTS "Issue_branchId_idx"         ON "Issue"("branchId");
CREATE INDEX IF NOT EXISTS "Issue_issuedByUserId_idx"   ON "Issue"("issuedByUserId");
CREATE INDEX IF NOT EXISTS "Issue_returnedByUserId_idx" ON "Issue"("returnedByUserId");

-- Reservations
CREATE INDEX IF NOT EXISTS "Reservation_titleId_idx"     ON "Reservation"("titleId");
CREATE INDEX IF NOT EXISTS "Reservation_memberId_idx"    ON "Reservation"("memberId");
CREATE INDEX IF NOT EXISTS "Reservation_branchId_idx"    ON "Reservation"("branchId");
CREATE INDEX IF NOT EXISTS "Reservation_readyCopyId_idx" ON "Reservation"("readyCopyId");

-- Money
CREATE INDEX IF NOT EXISTS "Fine_memberId_idx"       ON "Fine"("memberId");
CREATE INDEX IF NOT EXISTS "Fine_issueId_idx"        ON "Fine"("issueId");
CREATE INDEX IF NOT EXISTS "Fine_waivedByUserId_idx" ON "Fine"("waivedByUserId");

-- Members and the library period
CREATE INDEX IF NOT EXISTS "Member_homeBranchId_idx"     ON "Member"("homeBranchId");
CREATE INDEX IF NOT EXISTS "ClassVisit_branchId_idx"     ON "ClassVisit"("branchId");
CREATE INDEX IF NOT EXISTS "ClassVisit_periodId_idx"     ON "ClassVisit"("periodId");
CREATE INDEX IF NOT EXISTS "VisitAttendance_memberId_idx" ON "VisitAttendance"("memberId");
