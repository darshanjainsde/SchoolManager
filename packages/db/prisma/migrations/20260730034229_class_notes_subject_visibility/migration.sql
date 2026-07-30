/*
  Warnings:

  - Added the required column `subjectId` to the `ClassNote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subjectId` to the `ClassTodo` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ClassNoteVisibility" AS ENUM ('ALL_TEACHERS', 'SUBJECT_TEACHERS');

-- DropIndex
DROP INDEX "ClassNote_schoolId_classSectionId_date_idx";

-- DropIndex
DROP INDEX "ClassTodo_schoolId_classSectionId_date_idx";

-- AlterTable
ALTER TABLE "ClassNote" ADD COLUMN     "subjectId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "ClassTodo" ADD COLUMN     "subjectId" UUID NOT NULL;

-- Note: `prisma migrate dev` also proposed dropping the DB-level
-- `DEFAULT gen_random_uuid()` on ImpersonationToken.id and MarketingLead.id
-- (the same pre-existing drift called out in
-- 20260729011846_class_notes_todos_register_changes/migration.sql).
-- Intentionally left out here too — out of scope for this migration; those
-- tables are otherwise untouched.

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "classNoteVisibility" "ClassNoteVisibility" NOT NULL DEFAULT 'ALL_TEACHERS';

-- CreateIndex
CREATE INDEX "ClassNote_schoolId_classSectionId_date_subjectId_idx" ON "ClassNote"("schoolId", "classSectionId", "date", "subjectId");

-- CreateIndex
CREATE INDEX "ClassTodo_schoolId_classSectionId_date_subjectId_idx" ON "ClassTodo"("schoolId", "classSectionId", "date", "subjectId");

-- AddForeignKey
ALTER TABLE "ClassNote" ADD CONSTRAINT "ClassNote_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTodo" ADD CONSTRAINT "ClassTodo_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
