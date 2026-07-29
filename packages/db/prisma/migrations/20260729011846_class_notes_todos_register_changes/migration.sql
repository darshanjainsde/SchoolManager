-- CreateEnum
CREATE TYPE "RegisterChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Note: prisma migrate diff also proposed dropping the DB-level
-- `DEFAULT gen_random_uuid()` on ImpersonationToken.id and MarketingLead.id
-- (pre-existing drift from 20260711_000000_marketing_and_impersonation,
-- unrelated to this task's tables). Intentionally left out here — out of
-- scope for this migration; those tables are untouched.

-- CreateTable
CREATE TABLE "ClassNote" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classSectionId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "authorTeacherId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassTodo" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classSectionId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "authorTeacherId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassTodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegisterChangeRequest" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classSectionId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "requestedByTeacherId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RegisterChangeStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegisterChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClassNote_schoolId_classSectionId_date_idx" ON "ClassNote"("schoolId", "classSectionId", "date");

-- CreateIndex
CREATE INDEX "ClassTodo_schoolId_classSectionId_date_idx" ON "ClassTodo"("schoolId", "classSectionId", "date");

-- CreateIndex
CREATE INDEX "RegisterChangeRequest_schoolId_status_idx" ON "RegisterChangeRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "RegisterChangeRequest_schoolId_classSectionId_date_idx" ON "RegisterChangeRequest"("schoolId", "classSectionId", "date");

-- AddForeignKey
ALTER TABLE "ClassNote" ADD CONSTRAINT "ClassNote_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassNote" ADD CONSTRAINT "ClassNote_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTodo" ADD CONSTRAINT "ClassTodo_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTodo" ADD CONSTRAINT "ClassTodo_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterChangeRequest" ADD CONSTRAINT "RegisterChangeRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegisterChangeRequest" ADD CONSTRAINT "RegisterChangeRequest_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: own-tenant read/write. Pattern and role setup copied verbatim from
-- 20260722_040000_rls_new_tables/migration.sql (Attendance/Exam/Staff/...);
-- GRANTs are not needed here — ALTER DEFAULT PRIVILEGES ... GRANT ... ON
-- TABLES set up in 20260703_000100_rls_and_roles already covers every table
-- created afterwards, including these three.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ClassNote','ClassTodo','RegisterChangeRequest'
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
