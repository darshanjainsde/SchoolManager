-- The Library Wing: titles, copies, loans, fines, hall attendance, and the
-- librarian's rulebook. Plan: docs/superpowers/plans/2026-08-16-library-wing-build.md.

-- A librarian is an ordinary STAFF login with this role. ADD VALUE appends, and
-- is legal inside the migration's transaction on PG 12+ because nothing below
-- uses the new value. IF NOT EXISTS because the earlier library line
-- (20260815060000_staff_role_librarian, applied on staging) already added it
-- there — this migration must apply cleanly on both prod (value absent) and
-- staging (value present).
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'LIBRARIAN';

-- The earlier line also modelled the librarian as a USER role
-- (20260814120000_user_role_librarian) and minted such logins on staging.
-- This build's model is one staff login kind: the JOB (Staff.role) decides the
-- door. Fold any legacy LIBRARIAN logins back to STAFF; their Staff rows
-- already carry role = 'LIBRARIAN', so nothing about who they are is lost.
-- No-op wherever the enum value (or such users) never existed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'UserRole' AND e.enumlabel = 'LIBRARIAN'
  ) THEN
    UPDATE "User" SET "role" = 'STAFF' WHERE "role"::text = 'LIBRARIAN';
  END IF;
END $$;

-- Library pushes are single-reader rows (targetUserId) and a teacher has no
-- class section, so the outbox's section column becomes optional. The drain
-- reads classSectionId only when targetUserId is null, so no existing path
-- can see a null it does not expect.
ALTER TABLE "NotificationOutbox" ALTER COLUMN "classSectionId" DROP NOT NULL;

CREATE TYPE "LibraryFineReason" AS ENUM ('LATE', 'LOST');
CREATE TYPE "LibraryFineStatus" AS ENUM ('DUE', 'PAID', 'WAIVED');
CREATE TYPE "LibraryHallSource" AS ENUM ('SYNCED', 'RETAKEN');

-- One row per school, created on first read with the approved defaults.
CREATE TABLE "LibrarySettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "hallCapacityClasses" INTEGER NOT NULL DEFAULT 2,
  "studentLoanLimit" INTEGER NOT NULL DEFAULT 2,
  "teacherLoanLimit" INTEGER NOT NULL DEFAULT 5,
  "loanDays" INTEGER NOT NULL DEFAULT 14,
  "finePerDayRupees" INTEGER NOT NULL DEFAULT 5,
  "graceDays" INTEGER NOT NULL DEFAULT 1,
  "lostFeeRupees" INTEGER NOT NULL DEFAULT 120,
  "fineTeachers" BOOLEAN NOT NULL DEFAULT false,
  "dueSoonReminders" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibrarySettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LibrarySettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LibrarySettings_schoolId_key" ON "LibrarySettings"("schoolId");

CREATE TABLE "LibraryBookTitle" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "shelf" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryBookTitle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LibraryBookTitle_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LibraryBookTitle_schoolId_idx" ON "LibraryBookTitle"("schoolId");

-- The physical copy. accessionNo is the number on the sticker (B-00001 …),
-- allocated lexicographic-max+1 inside the tx; the unique index is the race
-- backstop, exactly like Student.code.
CREATE TABLE "LibraryBookCopy" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "titleId" UUID NOT NULL,
  "accessionNo" TEXT NOT NULL,
  "lostAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryBookCopy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LibraryBookCopy_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LibraryBookCopy_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "LibraryBookTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LibraryBookCopy_schoolId_accessionNo_key" ON "LibraryBookCopy"("schoolId", "accessionNo");
CREATE INDEX "LibraryBookCopy_schoolId_titleId_idx" ON "LibraryBookCopy"("schoolId", "titleId");

-- One loan. Open ⇔ returnedOn IS NULL.
CREATE TABLE "LibraryIssue" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "copyId" UUID NOT NULL,
  "studentId" UUID,
  "teacherId" UUID,
  "issuedOn" DATE NOT NULL,
  "dueOn" DATE NOT NULL,
  "returnedOn" DATE,
  "wasLost" BOOLEAN NOT NULL DEFAULT false,
  "issuedById" UUID NOT NULL,
  "returnedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryIssue_pkey" PRIMARY KEY ("id"),
  -- Exactly one borrower, enforced where the application cannot be trusted.
  CONSTRAINT "LibraryIssue_one_borrower" CHECK (("studentId" IS NULL) <> ("teacherId" IS NULL)),
  CONSTRAINT "LibraryIssue_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LibraryIssue_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "LibraryBookCopy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LibraryIssue_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LibraryIssue_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LibraryIssue_schoolId_returnedOn_idx" ON "LibraryIssue"("schoolId", "returnedOn");
CREATE INDEX "LibraryIssue_schoolId_studentId_idx" ON "LibraryIssue"("schoolId", "studentId");
CREATE INDEX "LibraryIssue_schoolId_teacherId_idx" ON "LibraryIssue"("schoolId", "teacherId");
CREATE INDEX "LibraryIssue_schoolId_copyId_idx" ON "LibraryIssue"("schoolId", "copyId");
CREATE INDEX "LibraryIssue_schoolId_dueOn_idx" ON "LibraryIssue"("schoolId", "dueOn");
-- THE race guard: one OPEN loan per physical copy, no matter what two warm
-- lambdas think they both just read. Same idea as the Student.code partial
-- index — the database, not the application, is the arbiter.
CREATE UNIQUE INDEX "LibraryIssue_open_copy_key" ON "LibraryIssue"("copyId") WHERE "returnedOn" IS NULL;

-- A crystallized amount owed — created at return (LATE) or write-off (LOST),
-- never while the book is still out.
CREATE TABLE "LibraryFine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "issueId" UUID NOT NULL,
  "studentId" UUID,
  "teacherId" UUID,
  "amountRupees" INTEGER NOT NULL,
  "reason" "LibraryFineReason" NOT NULL,
  "status" "LibraryFineStatus" NOT NULL DEFAULT 'DUE',
  "settledById" UUID,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryFine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LibraryFine_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LibraryFine_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "LibraryIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LibraryFine_schoolId_status_idx" ON "LibraryFine"("schoolId", "status");
CREATE INDEX "LibraryFine_schoolId_studentId_idx" ON "LibraryFine"("schoolId", "studentId");
CREATE INDEX "LibraryFine_schoolId_teacherId_idx" ON "LibraryFine"("schoolId", "teacherId");

-- The class's library-period register, saved by the librarian.
CREATE TABLE "LibraryHallVisit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "classSectionId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "periodId" UUID,
  "source" "LibraryHallSource" NOT NULL,
  "savedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LibraryHallVisit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LibraryHallVisit_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LibraryHallVisit_schoolId_classSectionId_date_key" ON "LibraryHallVisit"("schoolId", "classSectionId", "date");
CREATE INDEX "LibraryHallVisit_schoolId_date_idx" ON "LibraryHallVisit"("schoolId", "date");

CREATE TABLE "LibraryHallMark" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "visitId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "status" "AttendanceStatus" NOT NULL,
  CONSTRAINT "LibraryHallMark_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LibraryHallMark_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LibraryHallMark_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "LibraryHallVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LibraryHallMark_visitId_studentId_key" ON "LibraryHallMark"("visitId", "studentId");
CREATE INDEX "LibraryHallMark_schoolId_idx" ON "LibraryHallMark"("schoolId");

-- ── Row level security ──────────────────────────────────────────────────────
--
-- Plain tenant isolation on all seven tables. Nothing in the library is ever
-- read cross-tenant: no owner path, no network path, no public path.
ALTER TABLE "LibrarySettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibrarySettings" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "LibrarySettings"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "LibraryBookTitle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibraryBookTitle" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "LibraryBookTitle"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "LibraryBookCopy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibraryBookCopy" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "LibraryBookCopy"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "LibraryIssue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibraryIssue" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "LibraryIssue"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "LibraryFine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibraryFine" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "LibraryFine"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "LibraryHallVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibraryHallVisit" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "LibraryHallVisit"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "LibraryHallMark" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibraryHallMark" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "LibraryHallMark"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
