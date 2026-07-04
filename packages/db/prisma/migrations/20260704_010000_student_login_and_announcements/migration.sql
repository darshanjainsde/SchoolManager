-- Student login linkage
ALTER TABLE "Student" ADD COLUMN "userId" UUID;
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- Announcements
CREATE TABLE "Announcement" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "classSectionId" UUID,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Announcement_schoolId_idx" ON "Announcement"("schoolId");
CREATE INDEX "Announcement_schoolId_classSectionId_idx" ON "Announcement"("schoolId", "classSectionId");
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: own-tenant read/write (GRANTs auto-applied via ALTER DEFAULT PRIVILEGES)
ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Announcement" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "Announcement"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
