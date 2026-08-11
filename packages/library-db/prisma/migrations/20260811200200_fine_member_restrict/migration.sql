-- Fix (review finding 4): Fine.member was ON DELETE CASCADE. Loan.member is
-- Restrict so loan history can't be silently destroyed, but Fine.loanId is
-- nullable and Fine.kind includes DAMAGE/OTHER (not just OVERDUE), so a
-- member can carry an OPEN fine with no Loan behind it at all. Under
-- Cascade, deleting that member would silently delete the fine too — money
-- genuinely owed, gone with no trace — the same "fails quietly" failure
-- mode Copy.title/Copy.branch's Restrict already exists to prevent for
-- physical stock.

ALTER TABLE "Fine" DROP CONSTRAINT "Fine_memberId_fkey";
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
