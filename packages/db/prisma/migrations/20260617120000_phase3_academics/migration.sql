-- Phase 3 — Academic structure (tenant-scoped, RLS-protected)
-- Tables: Grade, Class, Section, Subject, ClassSubjectTeacher, Enrollment
-- Every table carries schoolId and gets a tenant_iso policy identical in shape
-- to the Phase 1 policies (see 20260614190200_rls_and_roles).

-- ─── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'TRANSFERRED', 'GRADUATED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Grade ───────────────────────────────────────────────────────────────────
CREATE TABLE "Grade" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Grade_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Grade_schoolId_name_key" ON "Grade"("schoolId", "name");
CREATE UNIQUE INDEX "Grade_schoolId_sequence_key" ON "Grade"("schoolId", "sequence");
CREATE INDEX "Grade_schoolId_idx" ON "Grade"("schoolId");
ALTER TABLE "Grade"
  ADD CONSTRAINT "Grade_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Class ───────────────────────────────────────────────────────────────────
CREATE TABLE "Class" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "gradeId" UUID NOT NULL,
  "academicYearId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "classTeacherUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Class_schoolId_academicYearId_gradeId_name_key" ON "Class"("schoolId", "academicYearId", "gradeId", "name");
CREATE INDEX "Class_schoolId_idx" ON "Class"("schoolId");
ALTER TABLE "Class"
  ADD CONSTRAINT "Class_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Class_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Class_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE;

-- ─── Section ─────────────────────────────────────────────────────────────────
CREATE TABLE "Section" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "classId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "capacity" INTEGER NOT NULL DEFAULT 40,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Section_schoolId_classId_name_key" ON "Section"("schoolId", "classId", "name");
CREATE INDEX "Section_schoolId_idx" ON "Section"("schoolId");
ALTER TABLE "Section"
  ADD CONSTRAINT "Section_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Section_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE;

-- ─── Subject ─────────────────────────────────────────────────────────────────
CREATE TABLE "Subject" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isElective" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subject_schoolId_code_key" ON "Subject"("schoolId", "code");
CREATE INDEX "Subject_schoolId_idx" ON "Subject"("schoolId");
ALTER TABLE "Subject"
  ADD CONSTRAINT "Subject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE;

-- ─── ClassSubjectTeacher ─────────────────────────────────────────────────────
CREATE TABLE "ClassSubjectTeacher" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "classId" UUID NOT NULL,
  "subjectId" UUID NOT NULL,
  "teacherUserId" UUID NOT NULL,
  "sectionId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClassSubjectTeacher_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClassSubjectTeacher_schoolId_classId_subjectId_sectionId_key"
  ON "ClassSubjectTeacher"("schoolId", "classId", "subjectId", "sectionId");
CREATE INDEX "ClassSubjectTeacher_schoolId_idx" ON "ClassSubjectTeacher"("schoolId");
ALTER TABLE "ClassSubjectTeacher"
  ADD CONSTRAINT "ClassSubjectTeacher_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "ClassSubjectTeacher_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "ClassSubjectTeacher_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE;

-- ─── Enrollment ──────────────────────────────────────────────────────────────
CREATE TABLE "Enrollment" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "studentUserId" UUID NOT NULL,
  "classId" UUID NOT NULL,
  "sectionId" UUID,
  "academicYearId" UUID NOT NULL,
  "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exitedAt" TIMESTAMP(3),
  CONSTRAINT "Enrollment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Enrollment_schoolId_studentUserId_academicYearId_key"
  ON "Enrollment"("schoolId", "studentUserId", "academicYearId");
CREATE INDEX "Enrollment_schoolId_idx" ON "Enrollment"("schoolId");
CREATE INDEX "Enrollment_schoolId_classId_idx" ON "Enrollment"("schoolId", "classId");
ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Enrollment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Enrollment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "Enrollment_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE;

-- ─── RLS policies (identical shape to Phase 1) ──────────────────────────────
ALTER TABLE "Grade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Grade" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_grade ON "Grade"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "Class" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Class" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_class ON "Class"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "Section" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Section" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_section ON "Section"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "Subject" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subject" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_subject ON "Subject"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "ClassSubjectTeacher" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClassSubjectTeacher" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_cst ON "ClassSubjectTeacher"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "Enrollment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Enrollment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_enrollment ON "Enrollment"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

-- ─── Grants on the new tables ────────────────────────────────────────────────
-- Default privileges from the Phase-1 migration cover these, but be explicit
-- so a manual db:reset against an existing role set doesn't drop access.
GRANT SELECT, INSERT, UPDATE, DELETE ON "Grade", "Class", "Section", "Subject", "ClassSubjectTeacher", "Enrollment" TO skoolos_app, skoolos_platform;
