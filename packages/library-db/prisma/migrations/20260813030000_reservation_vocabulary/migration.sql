-- The rest of the vocabulary. "Hold" is library-speak; a child reserves a book.
-- "ON_LOAN" is the same jargon spelt as an enum value, and it would have leaked
-- to the student's phone through the availability screen.
--
-- Renames only. Enum-value renames preserve every existing row, which matters:
-- a DROP-and-recreate would need every dependent column rewritten and would put
-- the copy statuses through an intermediate state where nothing is valid.

ALTER TYPE "CopyStatus" RENAME VALUE 'ON_LOAN'       TO 'ISSUED';
ALTER TYPE "CopyStatus" RENAME VALUE 'ON_HOLD_SHELF' TO 'RESERVED_SHELF';

ALTER TYPE "HoldStatus" RENAME TO "ReservationStatus";
ALTER TABLE "Hold" RENAME TO "Reservation";

ALTER TABLE "Reservation" RENAME CONSTRAINT "Hold_pkey"             TO "Reservation_pkey";
ALTER TABLE "Reservation" RENAME CONSTRAINT "Hold_orgId_fkey"       TO "Reservation_orgId_fkey";
ALTER TABLE "Reservation" RENAME CONSTRAINT "Hold_titleId_fkey"     TO "Reservation_titleId_fkey";
ALTER TABLE "Reservation" RENAME CONSTRAINT "Hold_memberId_fkey"    TO "Reservation_memberId_fkey";
ALTER TABLE "Reservation" RENAME CONSTRAINT "Hold_readyCopyId_fkey" TO "Reservation_readyCopyId_fkey";
ALTER TABLE "Reservation" RENAME CONSTRAINT "Hold_branchId_fkey"    TO "Reservation_branchId_fkey";

ALTER INDEX "Hold_orgId_idx"          RENAME TO "Reservation_orgId_idx";
ALTER INDEX "Hold_orgId_branchId_idx" RENAME TO "Reservation_orgId_branchId_idx";

-- The partial unique index that stops one member reserving the same title
-- twice. Renamed, never dropped, so the guarantee is continuous.
ALTER INDEX "hold_one_pending_per_member_title" RENAME TO "reservation_one_per_member_title";

-- How many books may be reserved, and how long a reserved book is kept aside.
ALTER TABLE "CirculationPolicy" RENAME COLUMN "maxHolds"      TO "maxReservations";
ALTER TABLE "CirculationPolicy" RENAME COLUMN "holdShelfDays" TO "reservedShelfDays";
