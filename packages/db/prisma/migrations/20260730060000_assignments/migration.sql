-- Note: `prisma migrate diff` also proposed dropping the DB-level
-- `DEFAULT gen_random_uuid()` on ImpersonationToken.id and MarketingLead.id
-- (same pre-existing drift noted in 20260729011846_class_notes_todos_register_changes
-- and 20260730050000_notification_outbox). Intentionally left out here too —
-- out of scope for this migration; those tables are untouched.

-- CreateTable
CREATE TABLE "Assignment" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classSectionId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "createdByTeacherId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentSeen" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Assignment_schoolId_classSectionId_dueDate_idx" ON "Assignment"("schoolId", "classSectionId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentSeen_assignmentId_studentId_key" ON "AssignmentSeen"("assignmentId", "studentId");

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSeen" ADD CONSTRAINT "AssignmentSeen_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentSeen" ADD CONSTRAINT "AssignmentSeen_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: own-tenant read/write. Pattern and role setup copied verbatim from
-- 20260722_040000_rls_new_tables/migration.sql (Attendance/Exam/Staff/...);
-- GRANTs are not needed here — ALTER DEFAULT PRIVILEGES ... GRANT ... ON
-- TABLES set up in 20260703_000100_rls_and_roles already covers every table
-- created afterwards, including these two.

-- Assignment has a direct "schoolId" column: standard tenant policy.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Assignment'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;

-- AssignmentSeen: no "schoolId" column of its own — tenancy is derived via
-- AssignmentSeen.assignmentId -> Assignment.schoolId, the SAME pattern
-- Result's RLS policy uses for Result.examId -> Exam.schoolId (see
-- 20260722_040000_rls_new_tables/migration.sql).
ALTER TABLE "AssignmentSeen" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AssignmentSeen" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_iso ON "AssignmentSeen";
CREATE POLICY tenant_iso ON "AssignmentSeen"
  USING (EXISTS (SELECT 1 FROM "Assignment" a WHERE a.id = "AssignmentSeen"."assignmentId" AND a."schoolId"::text = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Assignment" a WHERE a.id = "AssignmentSeen"."assignmentId" AND a."schoolId"::text = current_setting('app.current_tenant', true)));
