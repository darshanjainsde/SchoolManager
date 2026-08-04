-- Phase 5·1: human-friendly student codes (RAF-00042) + the school's stable
-- 3-letter prefix. The code is allocated when a login is created; the partial
-- unique index guards concurrent allocation (NULLs excluded by Postgres's
-- default unique-index NULL semantics).

ALTER TABLE "School" ADD COLUMN "codePrefix" TEXT;

ALTER TABLE "Student" ADD COLUMN "code" TEXT;

CREATE UNIQUE INDEX "Student_schoolId_code_key" ON "Student"("schoolId", "code");
