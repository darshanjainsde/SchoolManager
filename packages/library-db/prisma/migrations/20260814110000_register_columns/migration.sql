-- The accession register's remaining canonical columns.
--
-- An Indian school library's register is a bound book with fourteen columns
-- that an auditor reads: date, accession number, author, title, edition,
-- volume, publisher, year, pages, source, price paid, call number, bill
-- number, remarks. Eleven of those already exist across Title and Copy. These
-- are the four that did not, and without them the register cannot be produced
-- at all — which is the one artefact that makes this software replace the
-- bound book rather than sit beside it.
--
-- All nullable. A school typing up four thousand existing books will not have
-- a bill number for a donation from 1994, and refusing the row for that would
-- send them back to the paper register.
--
-- `source` is TEXT, not an enum, deliberately. Purchase / Donation / Gift /
-- Replacement / Exchange / Transfer are what the columns actually say in
-- practice, the list differs by state board, and an enum here would need a
-- migration every time a school wrote something reasonable.
ALTER TABLE "Copy" ADD COLUMN "source"     TEXT;
ALTER TABLE "Copy" ADD COLUMN "billNumber" TEXT;
ALTER TABLE "Copy" ADD COLUMN "volume"     TEXT;
ALTER TABLE "Copy" ADD COLUMN "remarks"    TEXT;

-- Weeding: a copy withdrawn from stock keeps WHY and WHO, for the same reason
-- a write-off does. `CopyStatus.WITHDRAWN` already exists and nothing recorded
-- the circumstances, so a removed book was indistinguishable from a data error.
ALTER TABLE "Copy" ADD COLUMN "withdrawnAt"     TIMESTAMP(3);
ALTER TABLE "Copy" ADD COLUMN "withdrawnReason" TEXT;
ALTER TABLE "Copy" ADD COLUMN "withdrawnByUserId" UUID;
ALTER TABLE "Copy" ADD COLUMN "withdrawnApprovedByNote" TEXT;

ALTER TABLE "Copy"
  ADD CONSTRAINT "Copy_withdrawnByUserId_fkey" FOREIGN KEY ("withdrawnByUserId")
    REFERENCES "LibUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK index, per the rule the fk-indexes guard now enforces.
CREATE INDEX "Copy_withdrawnByUserId_idx" ON "Copy"("withdrawnByUserId");

-- A withdrawal is recorded in full or not at all: a date with no reason is a
-- row nobody can explain to an auditor a year later.
ALTER TABLE "Copy" ADD CONSTRAINT "Copy_withdrawal_is_complete"
  CHECK (("withdrawnAt" IS NULL) = ("withdrawnReason" IS NULL));

-- The register is read in accession order, per branch, and that is the ONLY
-- order it is ever read in — it is a chronological ledger, not a catalogue.
CREATE INDEX "Copy_register_order_idx" ON "Copy"("orgId", "branchId", "accessionNumber");
