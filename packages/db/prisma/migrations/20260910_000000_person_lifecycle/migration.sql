-- Person lifecycle (Active Roster, Track A). See
-- docs/superpowers/specs/2026-09-09-active-roster-celebrations-sessions-design.md §2, §5.
--
-- Additive only: new enums, new nullable/defaulted columns, new indexes. Old
-- code ignores every column added here, so this migration is safe to apply to
-- production BEFORE the code that reads it deploys. No table is created, so RLS
-- coverage is unchanged (the three tables already carry tenant_iso).

CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'ALUMNI', 'TRANSFERRED', 'LEFT');
CREATE TYPE "StaffStatus" AS ENUM ('ACTIVE', 'LEFT');

ALTER TABLE "Student"
  ADD COLUMN "status"            "StudentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "leftOn"            DATE,
  ADD COLUMN "leftReason"        TEXT,
  ADD COLUMN "leftNote"          TEXT,
  ADD COLUMN "alumniBatch"       TEXT,
  ADD COLUMN "statusChangedAt"   TIMESTAMP(3),
  ADD COLUMN "statusChangedById" UUID,
  ADD COLUMN "showOnWebsite"     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "photoConsent"      BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Teacher"
  ADD COLUMN "status"            "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "leftOn"            DATE,
  ADD COLUMN "leftReason"        TEXT,
  ADD COLUMN "leftNote"          TEXT,
  ADD COLUMN "statusChangedAt"   TIMESTAMP(3),
  ADD COLUMN "statusChangedById" UUID;

ALTER TABLE "Staff"
  ADD COLUMN "status"            "StaffStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "leftOn"            DATE,
  ADD COLUMN "leftReason"        TEXT,
  ADD COLUMN "leftNote"          TEXT,
  ADD COLUMN "statusChangedAt"   TIMESTAMP(3),
  ADD COLUMN "statusChangedById" UUID;

-- Backfill: a row already switched off keeps its meaning. `isActive` stays and
-- is kept equal to (status = 'ACTIVE') by the lifecycle service from here on.
UPDATE "Student" SET "status" = 'LEFT', "statusChangedAt" = now() WHERE "isActive" = false;
UPDATE "Teacher" SET "status" = 'LEFT', "statusChangedAt" = now() WHERE "isActive" = false;
UPDATE "Staff"   SET "status" = 'LEFT', "statusChangedAt" = now() WHERE "isActive" = false;

CREATE INDEX "Student_schoolId_status_idx" ON "Student"("schoolId", "status");
CREATE INDEX "Teacher_schoolId_status_idx" ON "Teacher"("schoolId", "status");
CREATE INDEX "Staff_schoolId_status_idx"   ON "Staff"("schoolId", "status");
