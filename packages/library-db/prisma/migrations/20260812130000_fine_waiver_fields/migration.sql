-- Task 10: a waiver records WHO waived a fine, HOW MUCH, and WHY — see the
-- Fine model's own schema doc for the full reasoning (waivedAmount can be
-- less than the outstanding balance for a partial waiver; it is never
-- re-derived from amount/paidAmount after the fact). No RLS work needed
-- here: Fine already carries ENABLE/FORCE ROW LEVEL SECURITY + the
-- org_isolation policy from 20260811190300_circulation_rls, which is
-- row-level and already covers these new columns.

ALTER TABLE "Fine" ADD COLUMN "waivedByUserId" UUID;
ALTER TABLE "Fine" ADD COLUMN "waivedAmount" DECIMAL(10,2);
ALTER TABLE "Fine" ADD COLUMN "waivedReason" TEXT;
ALTER TABLE "Fine" ADD COLUMN "waivedAt" TIMESTAMP(3);

-- SetNull, not Restrict: the waiving LibUser leaving/being deleted must not
-- block user deletion — the money itself (waivedAmount/waivedReason) stays
-- on the row either way, only the "who" link is lost.
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_waivedByUserId_fkey"
  FOREIGN KEY ("waivedByUserId") REFERENCES "LibUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
