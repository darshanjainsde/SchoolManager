-- New MediaAsset kinds for course images and hall-of-fame photos
ALTER TYPE "MediaKind" ADD VALUE IF NOT EXISTS 'COURSE';
ALTER TYPE "MediaKind" ADD VALUE IF NOT EXISTS 'HOF';

-- Public "courses/classes offered" — CMS content for all tiers
CREATE TABLE "Course" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "tagline" TEXT,
  "description" TEXT,
  "highlights" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "ageRange" TEXT,
  "imageAssetId" UUID,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Course_schoolId_idx" ON "Course"("schoolId");
ALTER TABLE "Course" ADD CONSTRAINT "Course_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fee display row, one per course (free-text amounts)
CREATE TABLE "CourseFee" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "courseId" UUID NOT NULL,
  "admissionFee" TEXT,
  "annualFee" TEXT,
  "includes" TEXT,
  CONSTRAINT "CourseFee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CourseFee_courseId_key" ON "CourseFee"("courseId");
CREATE INDEX "CourseFee_schoolId_idx" ON "CourseFee"("schoolId");
ALTER TABLE "CourseFee" ADD CONSTRAINT "CourseFee_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseFee" ADD CONSTRAINT "CourseFee_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Admission process steps
CREATE TABLE "AdmissionStep" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AdmissionStep_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdmissionStep_schoolId_idx" ON "AdmissionStep"("schoolId");
ALTER TABLE "AdmissionStep" ADD CONSTRAINT "AdmissionStep_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Per-school admissions display settings
CREATE TABLE "AdmissionsSettings" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "showFeesPublicly" BOOLEAN NOT NULL DEFAULT true,
  "feeNote" TEXT,
  CONSTRAINT "AdmissionsSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdmissionsSettings_schoolId_key" ON "AdmissionsSettings"("schoolId");
ALTER TABLE "AdmissionsSettings" ADD CONSTRAINT "AdmissionsSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Class-wise hall of fame (ranks 1..3 per course)
CREATE TABLE "HallOfFameEntry" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "courseId" UUID NOT NULL,
  "rank" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "achievement" TEXT,
  "year" TEXT,
  "photoAssetId" UUID,
  CONSTRAINT "HallOfFameEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HallOfFameEntry_courseId_rank_key" ON "HallOfFameEntry"("courseId", "rank");
CREATE INDEX "HallOfFameEntry_schoolId_idx" ON "HallOfFameEntry"("schoolId");
ALTER TABLE "HallOfFameEntry" ADD CONSTRAINT "HallOfFameEntry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HallOfFameEntry" ADD CONSTRAINT "HallOfFameEntry_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: own-tenant read/write (GRANTs auto-applied via ALTER DEFAULT PRIVILEGES)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['Course','CourseFee','AdmissionStep','AdmissionsSettings','HallOfFameEntry'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
