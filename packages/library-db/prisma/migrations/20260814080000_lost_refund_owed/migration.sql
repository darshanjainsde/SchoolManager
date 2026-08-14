-- The old copy turned up, after the parent had already paid.
--
-- The school now has both the money and the book. Software cannot send money
-- back, and pretending otherwise would be worse than useless — so this records
-- an OBLIGATION and refuses to let anyone forget it, which is the honest thing
-- a program can do here.
--
-- Deliberately NOT a new `FineStatus` value. Adding `REFUND` or `CREDIT` to a
-- money enum that is already shipped would silently change the meaning of every
-- sum built on it — the dues list, the collections tiles, P4's `/me/dues` —
-- for an event that happens a handful of times a year. The fine stays PAID,
-- because it WAS paid; what changed is that the school owes something back.
--
-- Nor a credit wallet: a library credit is spendable on nothing else in this
-- product, so a credit a child can never use is strictly worse than a written
-- down refund obligation a librarian can see and settle at the desk.
ALTER TABLE "LostReport" ADD COLUMN "refundOwedAmount" DECIMAL(10,2);
ALTER TABLE "LostReport" ADD COLUMN "refundedAt"       TIMESTAMP(3);
ALTER TABLE "LostReport" ADD COLUMN "refundedByUserId" UUID;

ALTER TABLE "LostReport"
  ADD CONSTRAINT "LostReport_refundedByUserId_fkey" FOREIGN KEY ("refundedByUserId")
    REFERENCES "LibUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexed like every other FK on this table: without it, deleting a LibUser
-- sequentially scans every lost report the school has ever filed. Measured
-- consequence of getting this wrong is in the 20260813070000 migration's own
-- comment.
CREATE INDEX "LostReport_refundedByUserId_idx" ON "LostReport"("refundedByUserId");

-- A refund cannot be marked given if none was ever owed, and the amount is
-- money so it cannot be negative. Both in the database rather than the handler,
-- for the same reason as every other CHECK on this table: no future route or
-- script should be able to produce a refund record that cannot be explained.
ALTER TABLE "LostReport" ADD CONSTRAINT "LostReport_refund_nonnegative"
  CHECK ("refundOwedAmount" IS NULL OR "refundOwedAmount" >= 0);
ALTER TABLE "LostReport" ADD CONSTRAINT "LostReport_refunded_needs_owed"
  CHECK ("refundedAt" IS NULL OR "refundOwedAmount" IS NOT NULL);
