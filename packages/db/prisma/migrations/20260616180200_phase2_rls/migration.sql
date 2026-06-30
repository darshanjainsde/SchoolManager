-- RLS for tables added in Phase 2.

ALTER TABLE "AcademicYear" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcademicYear" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_academicyear ON "AcademicYear"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));
