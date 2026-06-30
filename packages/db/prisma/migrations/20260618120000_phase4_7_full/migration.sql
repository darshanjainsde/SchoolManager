-- Phase 4-7 + PlatformSetting — one combined migration.
--
-- Adds: PlatformSetting, Attendance, Assignment, Submission, GradingScheme,
--       Exam, ExamSubject, ExamResult, Mark, ReportCard,
--       Lead, AdmissionApplication, FeeStructure, FeeStructureItem,
--       FeePlanAssignment, Invoice, Payment, Discount, Subscription,
--       Announcement, Notification, Message, IdempotencyKey.
-- Plus RLS for every tenant-scoped table (i.e. all of the above except
-- PlatformSetting and IdempotencyKey).

-- ─── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT','ABSENT','LATE','EXCUSED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "ExamResultStatus" AS ENUM ('DRAFT','PUBLISHED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "LeadStage" AS ENUM ('NEW','CONTACTED','TOUR_BOOKED','APPLIED','ENROLLED','LOST'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "ApplicationStatus" AS ENUM ('SUBMITTED','UNDER_REVIEW','OFFERED','ACCEPTED','REJECTED','WAITLISTED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN','PARTIAL','PAID','VOID','REFUNDED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PaymentMethod" AS ENUM ('CARD','BANK','CASH','OTHER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "DiscountType" AS ENUM ('PERCENT','FIXED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "AnnouncementAudience" AS ENUM ('SCHOOL','ROLE','CLASS','USER'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── PlatformSetting ─────────────────────────────────────────────────────────
CREATE TABLE "PlatformSetting" (
  "key" TEXT NOT NULL,
  "valueCipher" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'global',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" UUID,
  CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "PlatformSetting_scope_idx" ON "PlatformSetting"("scope");

-- ─── Attendance ──────────────────────────────────────────────────────────────
CREATE TABLE "Attendance" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "enrollmentId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "status" "AttendanceStatus" NOT NULL,
  "markedByUserId" UUID NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Attendance_schoolId_enrollmentId_date_key" ON "Attendance"("schoolId","enrollmentId","date");
CREATE INDEX "Attendance_schoolId_idx" ON "Attendance"("schoolId");
CREATE INDEX "Attendance_schoolId_date_idx" ON "Attendance"("schoolId","date");
ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Attendance_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "Enrollment"("id") ON DELETE CASCADE;

-- ─── Assignment ──────────────────────────────────────────────────────────────
CREATE TABLE "Assignment" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "classId" UUID NOT NULL,
  "sectionId" UUID,
  "subjectId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "attachmentUrl" TEXT,
  "maxPoints" INTEGER NOT NULL DEFAULT 100,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Assignment_schoolId_idx" ON "Assignment"("schoolId");
CREATE INDEX "Assignment_schoolId_classId_idx" ON "Assignment"("schoolId","classId");
ALTER TABLE "Assignment"
  ADD CONSTRAINT "Assignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Assignment_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Assignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "Assignment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE;

-- ─── Submission ──────────────────────────────────────────────────────────────
CREATE TABLE "Submission" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "assignmentId" UUID NOT NULL,
  "studentUserId" UUID NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attachmentUrl" TEXT,
  "body" TEXT,
  "grade" DECIMAL(6,2),
  "feedback" TEXT,
  "isLate" BOOLEAN NOT NULL DEFAULT false,
  "gradedAt" TIMESTAMP(3),
  "gradedByUserId" UUID,
  CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Submission_assignmentId_studentUserId_key" ON "Submission"("assignmentId","studentUserId");
CREATE INDEX "Submission_schoolId_idx" ON "Submission"("schoolId");
ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE;

-- ─── GradingScheme ───────────────────────────────────────────────────────────
CREATE TABLE "GradingScheme" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "bands" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GradingScheme_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GradingScheme_schoolId_name_key" ON "GradingScheme"("schoolId","name");
CREATE INDEX "GradingScheme_schoolId_idx" ON "GradingScheme"("schoolId");
ALTER TABLE "GradingScheme"
  ADD CONSTRAINT "GradingScheme_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE;

-- ─── Exam ────────────────────────────────────────────────────────────────────
CREATE TABLE "Exam" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "classId" UUID NOT NULL,
  "sectionId" UUID,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "gradingSchemeId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Exam_schoolId_idx" ON "Exam"("schoolId");
CREATE INDEX "Exam_schoolId_classId_idx" ON "Exam"("schoolId","classId");
ALTER TABLE "Exam"
  ADD CONSTRAINT "Exam_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Exam_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Exam_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE SET NULL;

-- ─── ExamSubject ─────────────────────────────────────────────────────────────
CREATE TABLE "ExamSubject" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "examId" UUID NOT NULL,
  "subjectId" UUID NOT NULL,
  "maxMarks" INTEGER NOT NULL,
  "passingMarks" INTEGER NOT NULL,
  CONSTRAINT "ExamSubject_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExamSubject_examId_subjectId_key" ON "ExamSubject"("examId","subjectId");
CREATE INDEX "ExamSubject_schoolId_idx" ON "ExamSubject"("schoolId");
ALTER TABLE "ExamSubject"
  ADD CONSTRAINT "ExamSubject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "ExamSubject_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "ExamSubject_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE;

-- ─── ExamResult ──────────────────────────────────────────────────────────────
CREATE TABLE "ExamResult" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "examId" UUID NOT NULL,
  "studentUserId" UUID NOT NULL,
  "status" "ExamResultStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExamResult_examId_studentUserId_key" ON "ExamResult"("examId","studentUserId");
CREATE INDEX "ExamResult_schoolId_idx" ON "ExamResult"("schoolId");
ALTER TABLE "ExamResult"
  ADD CONSTRAINT "ExamResult_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "ExamResult_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE;

-- ─── Mark ────────────────────────────────────────────────────────────────────
CREATE TABLE "Mark" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "examResultId" UUID NOT NULL,
  "examSubjectId" UUID NOT NULL,
  "marksObtained" DECIMAL(6,2) NOT NULL,
  "isAbsent" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Mark_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Mark_examResultId_examSubjectId_key" ON "Mark"("examResultId","examSubjectId");
CREATE INDEX "Mark_schoolId_idx" ON "Mark"("schoolId");
ALTER TABLE "Mark"
  ADD CONSTRAINT "Mark_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Mark_examResultId_fkey" FOREIGN KEY ("examResultId") REFERENCES "ExamResult"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Mark_examSubjectId_fkey" FOREIGN KEY ("examSubjectId") REFERENCES "ExamSubject"("id") ON DELETE CASCADE;

-- ─── ReportCard ──────────────────────────────────────────────────────────────
CREATE TABLE "ReportCard" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "examResultId" UUID NOT NULL,
  "pdfUrl" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportCard_examResultId_key" ON "ReportCard"("examResultId");
CREATE INDEX "ReportCard_schoolId_idx" ON "ReportCard"("schoolId");
ALTER TABLE "ReportCard"
  ADD CONSTRAINT "ReportCard_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "ReportCard_examResultId_fkey" FOREIGN KEY ("examResultId") REFERENCES "ExamResult"("id") ON DELETE CASCADE;

-- ─── Lead ────────────────────────────────────────────────────────────────────
CREATE TABLE "Lead" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "fullName" TEXT NOT NULL,
  "contactEmail" TEXT,
  "contactPhone" TEXT,
  "gradeAppliedFor" TEXT,
  "source" TEXT,
  "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
  "assignedToUserId" UUID,
  "nextActionAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Lead_schoolId_idx" ON "Lead"("schoolId");
CREATE INDEX "Lead_schoolId_stage_idx" ON "Lead"("schoolId","stage");
ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE;

-- ─── AdmissionApplication ────────────────────────────────────────────────────
CREATE TABLE "AdmissionApplication" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "leadId" UUID,
  "applicantData" JSONB NOT NULL,
  "status" "ApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reviewerUserId" UUID,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdmissionApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdmissionApplication_schoolId_idx" ON "AdmissionApplication"("schoolId");
CREATE INDEX "AdmissionApplication_schoolId_status_idx" ON "AdmissionApplication"("schoolId","status");
ALTER TABLE "AdmissionApplication"
  ADD CONSTRAINT "AdmissionApplication_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "AdmissionApplication_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL;

-- ─── FeeStructure + item + assignment ────────────────────────────────────────
CREATE TABLE "FeeStructure" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "academicYearId" UUID NOT NULL,
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeeStructure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FeeStructure_schoolId_academicYearId_name_key" ON "FeeStructure"("schoolId","academicYearId","name");
CREATE INDEX "FeeStructure_schoolId_idx" ON "FeeStructure"("schoolId");
ALTER TABLE "FeeStructure"
  ADD CONSTRAINT "FeeStructure_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "FeeStructure_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE;

CREATE TABLE "FeeStructureItem" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "feeStructureId" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "dueDate" DATE NOT NULL,
  CONSTRAINT "FeeStructureItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FeeStructureItem_schoolId_idx" ON "FeeStructureItem"("schoolId");
CREATE INDEX "FeeStructureItem_feeStructureId_idx" ON "FeeStructureItem"("feeStructureId");
ALTER TABLE "FeeStructureItem"
  ADD CONSTRAINT "FeeStructureItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "FeeStructureItem_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "FeeStructure"("id") ON DELETE CASCADE;

CREATE TABLE "FeePlanAssignment" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "feeStructureId" UUID NOT NULL,
  "studentUserId" UUID NOT NULL,
  "overrides" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeePlanAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FeePlanAssignment_feeStructureId_studentUserId_key" ON "FeePlanAssignment"("feeStructureId","studentUserId");
CREATE INDEX "FeePlanAssignment_schoolId_idx" ON "FeePlanAssignment"("schoolId");
ALTER TABLE "FeePlanAssignment"
  ADD CONSTRAINT "FeePlanAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "FeePlanAssignment_feeStructureId_fkey" FOREIGN KEY ("feeStructureId") REFERENCES "FeeStructure"("id") ON DELETE CASCADE;

-- ─── Invoice ─────────────────────────────────────────────────────────────────
CREATE TABLE "Invoice" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "feePlanAssignmentId" UUID NOT NULL,
  "studentUserId" UUID NOT NULL,
  "amountDue" DECIMAL(12,2) NOT NULL,
  "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
  "dueDate" DATE NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invoice_schoolId_number_key" ON "Invoice"("schoolId","number");
CREATE INDEX "Invoice_schoolId_idx" ON "Invoice"("schoolId");
CREATE INDEX "Invoice_schoolId_status_idx" ON "Invoice"("schoolId","status");
CREATE INDEX "Invoice_schoolId_studentUserId_idx" ON "Invoice"("schoolId","studentUserId");
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Invoice_feePlanAssignmentId_fkey" FOREIGN KEY ("feePlanAssignmentId") REFERENCES "FeePlanAssignment"("id") ON DELETE CASCADE;

-- ─── Payment ─────────────────────────────────────────────────────────────────
CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "stripePaymentIntentId" TEXT,
  "stripeEventId" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedByUserId" UUID,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");
CREATE UNIQUE INDEX "Payment_stripeEventId_key" ON "Payment"("stripeEventId");
CREATE INDEX "Payment_schoolId_idx" ON "Payment"("schoolId");
CREATE INDEX "Payment_schoolId_invoiceId_idx" ON "Payment"("schoolId","invoiceId");
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE;

-- ─── Discount ────────────────────────────────────────────────────────────────
CREATE TABLE "Discount" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "invoiceId" UUID,
  "feePlanAssignmentId" UUID,
  "type" "DiscountType" NOT NULL,
  "value" DECIMAL(12,2) NOT NULL,
  "reason" TEXT NOT NULL,
  CONSTRAINT "Discount_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Discount_schoolId_idx" ON "Discount"("schoolId");
ALTER TABLE "Discount"
  ADD CONSTRAINT "Discount_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "Discount_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE;

-- ─── Subscription ────────────────────────────────────────────────────────────
CREATE TABLE "Subscription" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "plan" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Subscription_schoolId_key" ON "Subscription"("schoolId");
CREATE UNIQUE INDEX "Subscription_stripeCustomerId_key" ON "Subscription"("stripeCustomerId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
CREATE INDEX "Subscription_schoolId_idx" ON "Subscription"("schoolId");
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE;

-- ─── Announcement ────────────────────────────────────────────────────────────
CREATE TABLE "Announcement" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "authorUserId" UUID NOT NULL,
  "audience" "AnnouncementAudience" NOT NULL,
  "audienceRole" TEXT,
  "audienceClassId" UUID,
  "audienceUserId" UUID,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Announcement_schoolId_idx" ON "Announcement"("schoolId");
CREATE INDEX "Announcement_schoolId_createdAt_idx" ON "Announcement"("schoolId","createdAt");
ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE;

-- ─── Notification ────────────────────────────────────────────────────────────
CREATE TABLE "Notification" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "kind" TEXT NOT NULL,
  "payload" JSONB,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_schoolId_idx" ON "Notification"("schoolId");
CREATE INDEX "Notification_schoolId_userId_idx" ON "Notification"("schoolId","userId");
CREATE INDEX "Notification_schoolId_userId_readAt_idx" ON "Notification"("schoolId","userId","readAt");
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE;

-- ─── Message ─────────────────────────────────────────────────────────────────
CREATE TABLE "Message" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "threadId" UUID NOT NULL,
  "fromUserId" UUID NOT NULL,
  "toUserId" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Message_schoolId_idx" ON "Message"("schoolId");
CREATE INDEX "Message_schoolId_threadId_idx" ON "Message"("schoolId","threadId");
CREATE INDEX "Message_schoolId_toUserId_readAt_idx" ON "Message"("schoolId","toUserId","readAt");
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE;

-- ─── IdempotencyKey (not tenant-scoped; rows live globally with a composite key) ─
CREATE TABLE "IdempotencyKey" (
  "key" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "responseHash" TEXT NOT NULL,
  "responseBody" JSONB NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- ─── RLS policies for every tenant-scoped table ──────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Attendance','Assignment','Submission','GradingScheme','Exam','ExamSubject',
    'ExamResult','Mark','ReportCard','Lead','AdmissionApplication',
    'FeeStructure','FeeStructureItem','FeePlanAssignment','Invoice','Payment',
    'Discount','Subscription','Announcement','Notification','Message'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_iso_%s ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true))',
                   lower(replace(t,'.','_')), t);
  END LOOP;
END $$;

-- PlatformSetting and IdempotencyKey are NOT tenant-scoped, so they keep
-- "trust the app layer". Only the platform Prisma role accesses them.

-- Grants for the new tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "PlatformSetting","Attendance","Assignment","Submission","GradingScheme",
  "Exam","ExamSubject","ExamResult","Mark","ReportCard","Lead",
  "AdmissionApplication","FeeStructure","FeeStructureItem","FeePlanAssignment",
  "Invoice","Payment","Discount","Subscription","Announcement","Notification",
  "Message","IdempotencyKey"
  TO skoolos_app, skoolos_platform;
