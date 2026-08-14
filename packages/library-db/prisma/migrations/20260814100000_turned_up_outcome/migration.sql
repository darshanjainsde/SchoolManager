-- Record the DECISION when a copy turns up after it was paid for.
--
-- The first version wrote only `approvedByNote` for "the family keeps the
-- book", which left `refundOwedAmount` and `refundedAt` both null — and those
-- two were the whole re-entry guard. So FAMILY_KEEPS could be followed by
-- REFUND_OWED and both would stick: the school hands money back for a book the
-- family kept, and the copy rejoins the availability count while sitting in a
-- child's bag.
--
-- The decision needs state of its own, and the mutual exclusion needs to be a
-- CHECK rather than an `if` — this is money, and the handler is not the only
-- thing that will ever write this table.
CREATE TYPE "TurnedUpOutcome" AS ENUM ('REFUND_OWED', 'FAMILY_KEEPS');

ALTER TABLE "LostReport" ADD COLUMN "turnedUpAt"      TIMESTAMP(3);
ALTER TABLE "LostReport" ADD COLUMN "turnedUpOutcome" "TurnedUpOutcome";

-- The two move together or not at all.
ALTER TABLE "LostReport" ADD CONSTRAINT "LostReport_turned_up_together"
  CHECK (("turnedUpAt" IS NULL) = ("turnedUpOutcome" IS NULL));

-- A refund can only be owed when the outcome was REFUND_OWED. This is what
-- makes the two outcomes exclusive in the database rather than in an `if`.
ALTER TABLE "LostReport" ADD CONSTRAINT "LostReport_refund_matches_outcome"
  CHECK ("refundOwedAmount" IS NULL OR "turnedUpOutcome" = 'REFUND_OWED');
