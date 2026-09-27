-- Onboarding import log: one row per bulk import the Onboarding tab ran.
CREATE TABLE "OnboardingImport" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "rows" INTEGER NOT NULL,
  "created" INTEGER NOT NULL,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "academicYearId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnboardingImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OnboardingImport_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OnboardingImport_schoolId_createdAt_idx" ON "OnboardingImport"("schoolId", "createdAt");

-- Tenant isolation. app_current_tenant() with no cast on either side: casting
-- "schoolId"::text makes the column unusable as an index condition and turns
-- every tenant read into a scan of all tenants.
ALTER TABLE "OnboardingImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OnboardingImport" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "OnboardingImport"
  USING ("schoolId" = app_current_tenant())
  WITH CHECK ("schoolId" = app_current_tenant());
