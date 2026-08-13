-- The library period: a timetable, a room that holds only so many classes at
-- once, and a record of who actually came.

CREATE TABLE "LibrarySettings" (
  "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orgId"                   UUID NOT NULL UNIQUE,
  "concurrentClassCapacity" INTEGER NOT NULL DEFAULT 2,
  "recordAttendance"        BOOLEAN NOT NULL DEFAULT true,
  -- Off by default: most schools charge children nothing, and a default that
  -- quietly bills a ten-year-old is the wrong default.
  "chargeStudentFines"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibrarySettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LibrarySettings_capacity_positive" CHECK ("concurrentClassCapacity" > 0)
);

CREATE TABLE "LibraryPeriod" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orgId"     UUID NOT NULL,
  "branchId"  UUID NOT NULL,
  "weekday"   INTEGER NOT NULL,
  "period"    INTEGER NOT NULL,
  "classRef"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryPeriod_orgId_fkey"    FOREIGN KEY ("orgId")    REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LibraryPeriod_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id")     ON DELETE CASCADE ON UPDATE CASCADE,
  -- ISO weekday so ordering and arithmetic behave.
  CONSTRAINT "LibraryPeriod_weekday_range" CHECK ("weekday" BETWEEN 1 AND 7),
  CONSTRAINT "LibraryPeriod_period_range"  CHECK ("period" BETWEEN 1 AND 20)
);
-- One class cannot be booked into the same slot twice. How MANY classes may
-- share a slot is a setting, checked in the service: a unique index can say
-- "at most one", never "at most N".
CREATE UNIQUE INDEX "LibraryPeriod_slot_class_key" ON "LibraryPeriod"("branchId", "weekday", "period", "classRef");
CREATE INDEX "LibraryPeriod_lookup_idx" ON "LibraryPeriod"("orgId", "branchId", "weekday", "period");

CREATE TABLE "ClassVisit" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orgId"     UUID NOT NULL,
  "branchId"  UUID NOT NULL,
  "periodId"  UUID,
  "classRef"  TEXT NOT NULL,
  "date"      DATE NOT NULL,
  "openedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"  TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClassVisit_orgId_fkey"    FOREIGN KEY ("orgId")    REFERENCES "LibraryOrg"("id")    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClassVisit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id")        ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClassVisit_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "LibraryPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ClassVisit_closed_after_open" CHECK ("closedAt" IS NULL OR "closedAt" >= "openedAt")
);
-- One visit per class per day: a class that comes back later is the same visit
-- reopened, not a second record to reconcile.
CREATE UNIQUE INDEX "ClassVisit_one_per_class_day" ON "ClassVisit"("orgId", "classRef", "date");
CREATE INDEX "ClassVisit_branch_date_idx" ON "ClassVisit"("orgId", "branchId", "date");

CREATE TABLE "VisitAttendance" (
  "id"       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orgId"    UUID NOT NULL,
  "visitId"  UUID NOT NULL,
  "memberId" UUID NOT NULL,
  -- True when a circulation transaction put this row here rather than a person
  -- ticking a box. Issuing or returning PROVES presence, so the librarian only
  -- ticks the few who came and browsed.
  "auto"     BOOLEAN NOT NULL DEFAULT false,
  "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitAttendance_orgId_fkey"    FOREIGN KEY ("orgId")    REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VisitAttendance_visitId_fkey"  FOREIGN KEY ("visitId")  REFERENCES "ClassVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VisitAttendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id")     ON DELETE CASCADE ON UPDATE CASCADE
);
-- Present is present. The database enforces this under a double transaction,
-- not the handler.
CREATE UNIQUE INDEX "VisitAttendance_one_per_member_visit" ON "VisitAttendance"("visitId", "memberId");
CREATE INDEX "VisitAttendance_member_idx" ON "VisitAttendance"("orgId", "memberId");

-- Member gains the class label the timetable keys on. Plain text and nullable:
-- this must work before the Sckools link exists, and the sync populates it later.
ALTER TABLE "Member" ADD COLUMN "classRef" TEXT;
CREATE INDEX "Member_org_class_idx" ON "Member"("orgId", "classRef");

-- RLS, same fail-closed shape as every other table (see
-- 20260811190300_circulation_rls): NULLIF(current_setting(...), '') before the
-- ::uuid cast, because a pooled connection with no GUC set returns '' not NULL.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LibrarySettings','LibraryPeriod','ClassVisit','VisitAttendance'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I '
      'USING ("orgId" = NULLIF(current_setting(''app.current_org'', true), '''')::uuid) '
      'WITH CHECK ("orgId" = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA library TO library_app, library_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA library TO library_app, library_platform;
