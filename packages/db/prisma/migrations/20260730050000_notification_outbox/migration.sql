-- Note: prisma migrate diff also proposed dropping the DB-level
-- `DEFAULT gen_random_uuid()` on ImpersonationToken.id and MarketingLead.id
-- (same pre-existing drift from 20260711_000000_marketing_and_impersonation
-- noted in 20260729011846_class_notes_todos_register_changes). Intentionally
-- left out here too — out of scope for this migration; those tables are
-- untouched.

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "classSectionId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationOutbox_schoolId_sentAt_idx" ON "NotificationOutbox"("schoolId", "sentAt");

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: own-tenant read/write. Pattern and role setup copied verbatim from
-- 20260722_040000_rls_new_tables/migration.sql (Attendance/Exam/Staff/...);
-- GRANTs are not needed here — ALTER DEFAULT PRIVILEGES ... GRANT ... ON
-- TABLES set up in 20260703_000100_rls_and_roles already covers every table
-- created afterwards, including this one.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'NotificationOutbox'
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
