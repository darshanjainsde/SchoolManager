-- Hiring: a vacancy, the questions it screens on, and applications against it.

CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CLOSED');
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY');
CREATE TYPE "JobQuestionKind" AS ENUM ('CHOICE', 'YES_NO', 'NUMBER', 'TEXT');
CREATE TYPE "JobApplicationStatus" AS ENUM ('NEW', 'SHORTLISTED', 'INTERVIEWING', 'REJECTED', 'HIRED');

CREATE TABLE "JobPost" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
  "subject" TEXT,
  "posts" INTEGER NOT NULL DEFAULT 1,
  "salaryMinMinor" INTEGER,
  "salaryMaxMinor" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "applyBy" TIMESTAMP(3),
  "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
  "rejectedReason" TEXT,
  "createdByUserId" UUID,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobPost_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobPost_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "JobPost_schoolId_idx" ON "JobPost"("schoolId");
CREATE INDEX "JobPost_status_idx" ON "JobPost"("status");

CREATE TABLE "JobQuestion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "jobPostId" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "prompt" TEXT NOT NULL,
  "kind" "JobQuestionKind" NOT NULL DEFAULT 'CHOICE',
  "options" TEXT[],
  "required" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobQuestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobQuestion_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "JobQuestion_jobPostId_idx" ON "JobQuestion"("jobPostId");
CREATE INDEX "JobQuestion_schoolId_idx" ON "JobQuestion"("schoolId");

CREATE TABLE "JobApplication" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "jobPostId" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "cvUrl" TEXT NOT NULL,
  "answers" JSONB,
  "status" "JobApplicationStatus" NOT NULL DEFAULT 'NEW',
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JobApplication_jobPostId_fkey" FOREIGN KEY ("jobPostId") REFERENCES "JobPost"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "JobApplication_jobPostId_idx" ON "JobApplication"("jobPostId");
CREATE INDEX "JobApplication_schoolId_idx" ON "JobApplication"("schoolId");

-- ── Row level security ──────────────────────────────────────────────────────
--
-- Vacancies and their questions are plain tenant-isolated. The public board and
-- the owner's queue read them through the PLATFORM connection (sckools.com has
-- no tenant context at all), so no network read policy is needed here — and not
-- adding one keeps the surface as small as it can be.
ALTER TABLE "JobPost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobPost" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "JobPost"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "JobQuestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobQuestion" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "JobQuestion"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

-- APPLICATIONS ARE THE SENSITIVE ONE.
--
-- A private individual's name, phone and CV link, submitted by somebody with no
-- account. It belongs to the hiring school ALONE.
--
-- There is exactly ONE policy and it is single-tenant. Deliberately absent:
--   * any network read (unlike EventRegistration, which has one for network
--     events) — no school may ever see another school's candidates;
--   * any owner read — the owner moderates VACANCIES, never applicants.
-- Do not add either, even when asked for network-wide candidate search.
ALTER TABLE "JobApplication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobApplication" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "JobApplication"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
