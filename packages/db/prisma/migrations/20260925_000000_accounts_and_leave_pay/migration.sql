-- ═══════════════════════════════════════════════════════════════════════════
-- ACCOUNTS, AND LEAVE THAT REACHES PAY
--
-- Three things, in the order they depend on each other:
--   1. an ACCOUNTS staff job — a JOB, not a login kind, because the LIBRARIAN
--      value on UserRole records what happened the one time this was modelled
--      as a role and had to be undone;
--   2. staff can take leave at all (the column that did not exist), and a day
--      can be a half;
--   3. the school's one rule for what leave past its quota costs.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. the job ─────────────────────────────────────────────────────────────
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ACCOUNTS';

-- ── 2. what a day of unpaid leave costs ────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "LopBasis" AS ENUM ('CALENDAR_DAY', 'WORKING_DAY', 'WARN_ONLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "lopBasis" "LopBasis" NOT NULL DEFAULT 'CALENDAR_DAY';
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "lopCountsHalfDays" BOOLEAN NOT NULL DEFAULT true;

-- ── 3. staff leave, and half days ──────────────────────────────────────────
-- `teacherId` becomes nullable so a staff row can exist without one. Every
-- row that predates this has a teacher, so nothing is lost; the CHECK below
-- is what actually keeps the pair honest from here on.
ALTER TABLE "LeaveApplication" ALTER COLUMN "teacherId" DROP NOT NULL;
ALTER TABLE "LeaveApplication" ADD COLUMN IF NOT EXISTS "staffId" UUID;
ALTER TABLE "LeaveApplication" ADD COLUMN IF NOT EXISTS "halfDay" BOOLEAN NOT NULL DEFAULT false;

-- Exactly one of the two, the same rule the pay tables already carry.
ALTER TABLE "LeaveApplication"
  ADD CONSTRAINT "LeaveApplication_one_person"
  CHECK (("teacherId" IS NULL) <> ("staffId" IS NULL));

-- A half day is a single date. "Half of a five-day leave" is not a thing a
-- school means, and allowing it would make the deduction unanswerable.
ALTER TABLE "LeaveApplication"
  ADD CONSTRAINT "LeaveApplication_halfday_is_one_day"
  CHECK ("halfDay" = false OR "startDate" = "endDate");

-- Referential-integrity checks run OUTSIDE row-level security, so every
-- foreign key needs its own leading index (2026-09-21 tenancy audit).
CREATE INDEX IF NOT EXISTS "LeaveApplication_staffId_idx" ON "LeaveApplication"("staffId");
CREATE INDEX IF NOT EXISTS "LeaveApplication_schoolId_staffId_idx" ON "LeaveApplication"("schoolId", "staffId");

ALTER TABLE "LeaveApplication"
  ADD CONSTRAINT "LeaveApplication_staffId_fkey" FOREIGN KEY ("staffId")
  REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 4. quotas differ for teachers and staff, and some types never deduct ───
ALTER TABLE "LeaveTypeDef" ADD COLUMN IF NOT EXISTS "defaultAnnualStaff" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LeaveTypeDef" ADD COLUMN IF NOT EXISTS "neverDeduct" BOOLEAN NOT NULL DEFAULT false;

-- A school that already set a teacher quota meant it for everyone until now,
-- so staff start on the same figure rather than on zero — which would read as
-- "every staff member has overrun" on the first pay run after this ships.
UPDATE "LeaveTypeDef" SET "defaultAnnualStaff" = "defaultAnnual" WHERE "defaultAnnualStaff" = 0;

-- Maternity never costs pay, whatever the balance says.
UPDATE "LeaveTypeDef" SET "neverDeduct" = true
WHERE "builtin" = 'MATERNITY' OR lower("name") LIKE '%maternity%' OR lower("name") LIKE '%bereave%';

-- ── 5. half-day precision on the money side ────────────────────────────────
-- A second integer rather than making these Decimal: Prisma serialises
-- Decimal as a string, which would silently change a shape every client reads.
ALTER TABLE "PayAdjustment" ADD COLUMN IF NOT EXISTS "lopHalfDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PayAdjustment" ADD COLUMN IF NOT EXISTS "leaveApplicationId" UUID;
CREATE INDEX IF NOT EXISTS "PayAdjustment_leaveApplicationId_idx" ON "PayAdjustment"("leaveApplicationId");

ALTER TABLE "Payslip" ADD COLUMN IF NOT EXISTS "lopHalfDays" INTEGER NOT NULL DEFAULT 0;
