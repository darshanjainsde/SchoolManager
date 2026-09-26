-- Class-teacher history + the Complaint Box.
--
-- The live class teacher stays ClassSection.classTeacherId; this table is the
-- dated record behind it, so "who was 7 B's class teacher in March" has an
-- answer for a report card or a concern that was routed then.
CREATE TABLE "ClassTeacherAssignment" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "classSectionId" UUID NOT NULL,
  "teacherId" UUID NOT NULL,
  "untilAt" TIMESTAMP(3),
  "fromAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedById" UUID,
  CONSTRAINT "ClassTeacherAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ClassTeacherAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClassTeacherAssignment_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClassTeacherAssignment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ClassTeacherAssignment_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ClassTeacherAssignment_schoolId_classSectionId_fromAt_idx" ON "ClassTeacherAssignment"("schoolId", "classSectionId", "fromAt");
-- Indexed for the referential-integrity check Postgres runs on a parent
-- delete: that check never sees a tenant predicate, so it cannot use the
-- tenant index (see the 2026-09-21 tenancy audit).
CREATE INDEX "ClassTeacherAssignment_teacherId_idx" ON "ClassTeacherAssignment"("teacherId");
CREATE INDEX "ClassTeacherAssignment_changedById_idx" ON "ClassTeacherAssignment"("changedById");

-- The Complaint Box: one row per thing a family raised.
CREATE TABLE "Concern" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "raisedById" UUID NOT NULL,
  "raisedByRole" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "assignedTeacherId" UUID,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "attachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "readByOfficeAt" TIMESTAMP(3),
  "readByTeacherAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" UUID,
  "reopenedAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Concern_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Concern_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Concern_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Concern_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Concern_assignedTeacherId_fkey" FOREIGN KEY ("assignedTeacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Concern_schoolId_status_lastActivityAt_idx" ON "Concern"("schoolId", "status", "lastActivityAt");
CREATE INDEX "Concern_schoolId_assignedTeacherId_status_idx" ON "Concern"("schoolId", "assignedTeacherId", "status");
CREATE INDEX "Concern_schoolId_studentId_createdAt_idx" ON "Concern"("schoolId", "studentId", "createdAt");
CREATE INDEX "Concern_raisedById_idx" ON "Concern"("raisedById");
CREATE INDEX "Concern_studentId_idx" ON "Concern"("studentId");
CREATE INDEX "Concern_assignedTeacherId_idx" ON "Concern"("assignedTeacherId");

-- One timeline per concern: a reply the family sees, a private note, or a
-- status change — all one ordered story.
CREATE TABLE "ConcernComment" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "concernId" UUID NOT NULL,
  "authorId" UUID NOT NULL,
  "authorRole" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "visibleToFamily" BOOLEAN NOT NULL DEFAULT true,
  "statusFrom" TEXT,
  "statusTo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConcernComment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConcernComment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConcernComment_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConcernComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConcernComment_schoolId_concernId_createdAt_idx" ON "ConcernComment"("schoolId", "concernId", "createdAt");
CREATE INDEX "ConcernComment_concernId_idx" ON "ConcernComment"("concernId");
CREATE INDEX "ConcernComment_authorId_idx" ON "ConcernComment"("authorId");

-- Tenant isolation, the house pattern: app_current_tenant() with no cast on
-- either side, so "schoolId" stays usable as an index condition.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ClassTeacherAssignment','Concern','ConcernComment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('CREATE POLICY tenant_iso ON %I USING ("schoolId" = app_current_tenant()) WITH CHECK ("schoolId" = app_current_tenant());', t);
  END LOOP;
END $$;
