-- Message report & block (2026-10-19) — Google Play's user-generated-content
-- rule: an app with user-to-user messaging must let users report and block.
--
-- EXPAND ONLY. Two nullable columns on MessageThread (metadata-only on
-- Postgres 11+, no rewrite, every existing thread stays unblocked) and one new
-- table. Nothing existing is changed or dropped.

-- AlterTable
ALTER TABLE "MessageThread" ADD COLUMN "blockedByStudentAt" TIMESTAMP(3),
ADD COLUMN "blockedByTeacherAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MessageReport" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "threadId" UUID NOT NULL,
    "messageId" UUID,
    "reporterUserId" UUID NOT NULL,
    "reporterRole" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageReport_schoolId_status_createdAt_idx" ON "MessageReport"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MessageReport_threadId_idx" ON "MessageReport"("threadId");

-- CreateIndex
CREATE INDEX "MessageReport_messageId_idx" ON "MessageReport"("messageId");

-- AddForeignKey
ALTER TABLE "MessageReport" ADD CONSTRAINT "MessageReport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReport" ADD CONSTRAINT "MessageReport_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReport" ADD CONSTRAINT "MessageReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tenant isolation, the house pattern (see rls-coverage.e2e-spec.ts): every
-- table with a schoolId gets a forced tenant_iso policy on app_current_tenant().
ALTER TABLE "MessageReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageReport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "MessageReport" USING ("schoolId" = app_current_tenant()) WITH CHECK ("schoolId" = app_current_tenant());
