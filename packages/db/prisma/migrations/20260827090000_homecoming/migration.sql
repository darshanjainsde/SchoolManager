-- Homecoming — the alumni wing.
--
-- Eight tables. The DDL below is Prisma's own `migrate diff` output verbatim
-- (5.22.0, schema-to-schema against the previous migration's datamodel), so it
-- cannot drift from schema.prisma. The RLS block at the foot is hand-written
-- because Prisma does not emit policies.
--
-- Why Alumni is written FROM Student rather than typed: a school does not have
-- an alumni database, it has a graduating class every March. `Alumni.studentId`
-- is deliberately NOT a foreign key — deleting a student record must never
-- silently erase the alumni record built from it, and the two lifecycles are
-- genuinely independent once the child has left.
--
-- Two columns carry a frozen count: `GiftPledge.headcountAtPledge` and
-- `GuestSession.headcountAtBooking`. Both exist for the same reason
-- `EventRegistration.amountMinor` does — a donor agreed to a number, and that
-- number is the agreement. It must not move because three children joined in July.

-- CreateEnum
CREATE TYPE "AlumniStatus" AS ENUM ('SCHOOL_ADDED', 'INVITED', 'PENDING', 'VERIFIED', 'DECLINED', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'VERIFIED', 'DECLINED');

-- CreateEnum
CREATE TYPE "GiftScope" AS ENUM ('SCHOOL', 'GRADE', 'SECTION');

-- CreateEnum
CREATE TYPE "GiftMode" AS ENUM ('FUND', 'SUPPLY');

-- CreateEnum
CREATE TYPE "GiftStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'DECLINED', 'COUNTERED', 'CANCELLED', 'RECEIVED', 'DISTRIBUTED', 'REPORTED');

-- CreateEnum
CREATE TYPE "GiftDedication" AS ENUM ('NONE', 'IN_MEMORY_OF', 'IN_HONOUR_OF');

-- CreateEnum
CREATE TYPE "GiftVisibility" AS ENUM ('PUBLIC', 'ALUMNI', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "GuestSessionMode" AS ENUM ('IN_PERSON', 'ONLINE');

-- CreateEnum
CREATE TYPE "GuestSessionStatus" AS ENUM ('REQUESTED', 'COUNTERED', 'SCHEDULED', 'DECLINED', 'CANCELLED', 'DELIVERED');

-- CreateTable
CREATE TABLE "Alumni" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "studentId" UUID,
    "userId" UUID,
    "admissionNo" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "batchYear" INTEGER NOT NULL,
    "lastClass" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "country" TEXT,
    "profession" TEXT,
    "employer" TEXT,
    "collegeName" TEXT,
    "photoAssetId" UUID,
    "status" "AlumniStatus" NOT NULL DEFAULT 'SCHOOL_ADDED',
    "trustedForStudents" BOOLEAN NOT NULL DEFAULT false,
    "isBatchCaptain" BOOLEAN NOT NULL DEFAULT false,
    "isMentor" BOOLEAN NOT NULL DEFAULT false,
    "isDeceased" BOOLEAN NOT NULL DEFAULT false,
    "privacy" JSONB,
    "verifiedByUserId" UUID,
    "verifiedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alumni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlumniBatch" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "batchYear" INTEGER NOT NULL,
    "registerStrength" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlumniBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlumniClaim" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "batchYear" INTEGER NOT NULL,
    "claimedAdmissionNo" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "proof" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "matchedAlumniId" UUID,
    "vouchedByAlumniId" UUID,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlumniClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftItem" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'per child',
    "indicativeCostMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "sizesTracked" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftPledge" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "alumniId" UUID,
    "donorName" TEXT,
    "donorEmail" TEXT,
    "scopeKind" "GiftScope" NOT NULL,
    "gradeId" UUID,
    "classSectionId" UUID,
    "headcountAtPledge" INTEGER NOT NULL,
    "giftItemId" UUID,
    "customRequest" TEXT,
    "quantity" INTEGER NOT NULL,
    "mode" "GiftMode" NOT NULL,
    "amountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "dedicationKind" "GiftDedication" NOT NULL DEFAULT 'NONE',
    "dedicationText" TEXT,
    "visibility" "GiftVisibility" NOT NULL DEFAULT 'ALUMNI',
    "status" "GiftStatus" NOT NULL DEFAULT 'PROPOSED',
    "declineReason" TEXT,
    "counterNote" TEXT,
    "dueAt" TIMESTAMP(3),
    "acceptedByUserId" UUID,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftPledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftReceipt" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "pledgeId" UUID NOT NULL,
    "receivedQty" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedByUserId" UUID,
    "note" TEXT,

    CONSTRAINT "GiftReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftDistribution" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "pledgeId" UUID NOT NULL,
    "classSectionId" UUID,
    "distributedQty" INTEGER NOT NULL,
    "absentQty" INTEGER NOT NULL DEFAULT 0,
    "distributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byUserId" UUID,
    "note" TEXT,

    CONSTRAINT "GiftDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "alumniId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "mode" "GuestSessionMode" NOT NULL DEFAULT 'IN_PERSON',
    "classSectionId" UUID NOT NULL,
    "headcountAtBooking" INTEGER NOT NULL,
    "requestedDate" TIMESTAMP(3) NOT NULL,
    "requestedPeriodId" UUID NOT NULL,
    "counterDate" TIMESTAMP(3),
    "counterPeriodId" UUID,
    "counterNote" TEXT,
    "counterRound" INTEGER NOT NULL DEFAULT 0,
    "scheduledDate" TIMESTAMP(3),
    "scheduledPeriodId" UUID,
    "accompanyingTeacherId" UUID,
    "displacedSubjectId" UUID,
    "displacedTeacherId" UUID,
    "roomId" UUID,
    "meetingUrl" TEXT,
    "status" "GuestSessionStatus" NOT NULL DEFAULT 'REQUESTED',
    "declineReason" TEXT,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "attendedCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alumni_schoolId_batchYear_idx" ON "Alumni"("schoolId", "batchYear");

-- CreateIndex
CREATE INDEX "Alumni_schoolId_status_idx" ON "Alumni"("schoolId", "status");

-- CreateIndex
CREATE INDEX "Alumni_schoolId_trustedForStudents_idx" ON "Alumni"("schoolId", "trustedForStudents");

-- CreateIndex
CREATE UNIQUE INDEX "Alumni_schoolId_studentId_key" ON "Alumni"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "AlumniBatch_schoolId_idx" ON "AlumniBatch"("schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "AlumniBatch_schoolId_batchYear_key" ON "AlumniBatch"("schoolId", "batchYear");

-- CreateIndex
CREATE INDEX "AlumniClaim_schoolId_status_idx" ON "AlumniClaim"("schoolId", "status");

-- CreateIndex
CREATE INDEX "AlumniClaim_schoolId_batchYear_idx" ON "AlumniClaim"("schoolId", "batchYear");

-- CreateIndex
CREATE INDEX "GiftItem_schoolId_isActive_idx" ON "GiftItem"("schoolId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "GiftItem_schoolId_name_key" ON "GiftItem"("schoolId", "name");

-- CreateIndex
CREATE INDEX "GiftPledge_schoolId_status_idx" ON "GiftPledge"("schoolId", "status");

-- CreateIndex
CREATE INDEX "GiftPledge_schoolId_createdAt_idx" ON "GiftPledge"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "GiftPledge_alumniId_idx" ON "GiftPledge"("alumniId");

-- CreateIndex
CREATE INDEX "GiftPledge_giftItemId_idx" ON "GiftPledge"("giftItemId");

-- CreateIndex
CREATE INDEX "GiftPledge_schoolId_classSectionId_idx" ON "GiftPledge"("schoolId", "classSectionId");

-- CreateIndex
CREATE INDEX "GiftReceipt_schoolId_pledgeId_idx" ON "GiftReceipt"("schoolId", "pledgeId");

-- CreateIndex
CREATE INDEX "GiftReceipt_pledgeId_idx" ON "GiftReceipt"("pledgeId");

-- CreateIndex
CREATE INDEX "GiftDistribution_schoolId_pledgeId_idx" ON "GiftDistribution"("schoolId", "pledgeId");

-- CreateIndex
CREATE INDEX "GiftDistribution_pledgeId_idx" ON "GiftDistribution"("pledgeId");

-- CreateIndex
CREATE INDEX "GuestSession_schoolId_status_idx" ON "GuestSession"("schoolId", "status");

-- CreateIndex
CREATE INDEX "GuestSession_schoolId_requestedDate_idx" ON "GuestSession"("schoolId", "requestedDate");

-- CreateIndex
CREATE INDEX "GuestSession_alumniId_idx" ON "GuestSession"("alumniId");

-- CreateIndex
CREATE INDEX "GuestSession_schoolId_classSectionId_idx" ON "GuestSession"("schoolId", "classSectionId");

-- AddForeignKey
ALTER TABLE "Alumni" ADD CONSTRAINT "Alumni_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniBatch" ADD CONSTRAINT "AlumniBatch_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniClaim" ADD CONSTRAINT "AlumniClaim_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftItem" ADD CONSTRAINT "GiftItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftPledge" ADD CONSTRAINT "GiftPledge_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftPledge" ADD CONSTRAINT "GiftPledge_alumniId_fkey" FOREIGN KEY ("alumniId") REFERENCES "Alumni"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftPledge" ADD CONSTRAINT "GiftPledge_giftItemId_fkey" FOREIGN KEY ("giftItemId") REFERENCES "GiftItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftReceipt" ADD CONSTRAINT "GiftReceipt_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftReceipt" ADD CONSTRAINT "GiftReceipt_pledgeId_fkey" FOREIGN KEY ("pledgeId") REFERENCES "GiftPledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDistribution" ADD CONSTRAINT "GiftDistribution_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftDistribution" ADD CONSTRAINT "GiftDistribution_pledgeId_fkey" FOREIGN KEY ("pledgeId") REFERENCES "GiftPledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_alumniId_fkey" FOREIGN KEY ("alumniId") REFERENCES "Alumni"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: own-tenant read/write via the direct "schoolId", the same shape as the
-- other 70+ tenant tables (see 20260826090000_exam_hall). Compared as TEXT, not
-- cast to uuid, so a connection that has already served a scoped request reads
-- back '' and fails closed rather than raising a cast error (LIBRARY-TRAPS #1).
-- GRANTs come from the ALTER DEFAULT PRIVILEGES in 20260703_000100_rls_and_roles.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Alumni', 'AlumniBatch', 'AlumniClaim',
    'GiftItem', 'GiftPledge', 'GiftReceipt', 'GiftDistribution',
    'GuestSession'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
