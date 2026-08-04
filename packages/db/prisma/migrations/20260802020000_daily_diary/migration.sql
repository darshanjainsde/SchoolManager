-- Phase 5·3: the Daily Diary (teacher-written items + red-ink remarks a parent
-- signs), plus the attendance bar's notice receipts.
--
-- DiaryEntry is a diary PAGE line for one (class, date). `audience = ALL` keeps
-- no per-student rows at all; `SELECTED` lists them in DiaryRecipient. DiaryAck
-- is written lazily on read and carries the parent's signature for a REMARK.
-- AttendanceNotice is the receipt behind the "tell these families" cooldown.
--
-- All four carry a direct "schoolId" -> standard tenant RLS (pattern copied
-- verbatim from 20260801000000_notifications).

-- CreateEnum
CREATE TYPE "DiaryEntryKind" AS ENUM ('ITEM', 'REMARK');
CREATE TYPE "DiaryAudience" AS ENUM ('ALL', 'SELECTED');

-- CreateTable
CREATE TABLE "DiaryEntry" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classSectionId" UUID NOT NULL,
    "subjectId" UUID,
    "date" DATE NOT NULL,
    "kind" "DiaryEntryKind" NOT NULL DEFAULT 'ITEM',
    "audience" "DiaryAudience" NOT NULL DEFAULT 'ALL',
    "body" TEXT NOT NULL,
    "authorTeacherId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiaryEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiaryRecipient" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "studentId" UUID NOT NULL,

    CONSTRAINT "DiaryRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiaryAck" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedAt" TIMESTAMP(3),
    "signedName" TEXT,

    CONSTRAINT "DiaryAck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceNotice" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "classSectionId" UUID NOT NULL,
    "percent" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "sentByTeacherId" UUID NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiaryEntry_schoolId_classSectionId_date_idx" ON "DiaryEntry"("schoolId", "classSectionId", "date");
CREATE UNIQUE INDEX "DiaryRecipient_entryId_studentId_key" ON "DiaryRecipient"("entryId", "studentId");
CREATE INDEX "DiaryRecipient_schoolId_studentId_idx" ON "DiaryRecipient"("schoolId", "studentId");
CREATE UNIQUE INDEX "DiaryAck_entryId_studentId_key" ON "DiaryAck"("entryId", "studentId");
CREATE INDEX "DiaryAck_schoolId_studentId_idx" ON "DiaryAck"("schoolId", "studentId");
CREATE INDEX "AttendanceNotice_schoolId_studentId_sentAt_idx" ON "AttendanceNotice"("schoolId", "studentId", "sentAt");
CREATE INDEX "AttendanceNotice_schoolId_classSectionId_sentAt_idx" ON "AttendanceNotice"("schoolId", "classSectionId", "sentAt");

-- AddForeignKey
ALTER TABLE "DiaryEntry" ADD CONSTRAINT "DiaryEntry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiaryEntry" ADD CONSTRAINT "DiaryEntry_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiaryEntry" ADD CONSTRAINT "DiaryEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DiaryRecipient" ADD CONSTRAINT "DiaryRecipient_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "DiaryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiaryRecipient" ADD CONSTRAINT "DiaryRecipient_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiaryAck" ADD CONSTRAINT "DiaryAck_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "DiaryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiaryAck" ADD CONSTRAINT "DiaryAck_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceNotice" ADD CONSTRAINT "AttendanceNotice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceNotice" ADD CONSTRAINT "AttendanceNotice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: own-tenant read/write via the direct "schoolId". GRANTs are covered by
-- the ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES set up in
-- 20260703_000100_rls_and_roles for every table created afterwards.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['DiaryEntry', 'DiaryRecipient', 'DiaryAck', 'AttendanceNotice'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
