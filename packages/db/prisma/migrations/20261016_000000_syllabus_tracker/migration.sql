-- Syllabus tracker (2026-10-16). Expand-only: three new tables and one enum,
-- nothing existing is touched. Chapters key on Grade+Subject (year-free);
-- progress and student notes key on the year-bound ClassSection / Student.

-- CreateEnum
CREATE TYPE "SyllabusStatus" AS ENUM ('NOT_STARTED', 'TEACHING', 'DONE');

-- CreateTable
CREATE TABLE "SyllabusChapter" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "gradeId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "parentId" UUID,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyllabusChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyllabusProgress" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classSectionId" UUID NOT NULL,
    "chapterId" UUID NOT NULL,
    "status" "SyllabusStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "note" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyllabusProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyllabusStudentNote" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "chapterId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyllabusStudentNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyllabusChapter_schoolId_gradeId_subjectId_idx" ON "SyllabusChapter"("schoolId", "gradeId", "subjectId");

-- CreateIndex
CREATE INDEX "SyllabusChapter_gradeId_idx" ON "SyllabusChapter"("gradeId");

-- CreateIndex
CREATE INDEX "SyllabusChapter_subjectId_idx" ON "SyllabusChapter"("subjectId");

-- CreateIndex
CREATE INDEX "SyllabusChapter_parentId_idx" ON "SyllabusChapter"("parentId");

-- CreateIndex
CREATE INDEX "SyllabusProgress_schoolId_classSectionId_idx" ON "SyllabusProgress"("schoolId", "classSectionId");

-- CreateIndex
CREATE INDEX "SyllabusProgress_chapterId_idx" ON "SyllabusProgress"("chapterId");

-- CreateIndex
CREATE INDEX "SyllabusProgress_updatedById_idx" ON "SyllabusProgress"("updatedById");

-- CreateIndex
CREATE UNIQUE INDEX "SyllabusProgress_classSectionId_chapterId_key" ON "SyllabusProgress"("classSectionId", "chapterId");

-- CreateIndex
CREATE INDEX "SyllabusStudentNote_schoolId_studentId_idx" ON "SyllabusStudentNote"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "SyllabusStudentNote_chapterId_idx" ON "SyllabusStudentNote"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "SyllabusStudentNote_studentId_chapterId_key" ON "SyllabusStudentNote"("studentId", "chapterId");

-- AddForeignKey
ALTER TABLE "SyllabusChapter" ADD CONSTRAINT "SyllabusChapter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusChapter" ADD CONSTRAINT "SyllabusChapter_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusChapter" ADD CONSTRAINT "SyllabusChapter_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusChapter" ADD CONSTRAINT "SyllabusChapter_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SyllabusChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusProgress" ADD CONSTRAINT "SyllabusProgress_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusProgress" ADD CONSTRAINT "SyllabusProgress_classSectionId_fkey" FOREIGN KEY ("classSectionId") REFERENCES "ClassSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusProgress" ADD CONSTRAINT "SyllabusProgress_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "SyllabusChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusProgress" ADD CONSTRAINT "SyllabusProgress_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusStudentNote" ADD CONSTRAINT "SyllabusStudentNote_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusStudentNote" ADD CONSTRAINT "SyllabusStudentNote_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyllabusStudentNote" ADD CONSTRAINT "SyllabusStudentNote_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "SyllabusChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Tenant isolation, the house pattern (see rls-coverage.e2e-spec.ts): every
-- table with a schoolId gets a forced tenant_iso policy on app_current_tenant().
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SyllabusChapter', 'SyllabusProgress', 'SyllabusStudentNote'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('CREATE POLICY tenant_iso ON %I USING ("schoolId" = app_current_tenant()) WITH CHECK ("schoolId" = app_current_tenant());', t);
  END LOOP;
END $$;
