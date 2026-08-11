-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'RETURNED', 'LOST');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('PENDING', 'READY', 'COLLECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FineKind" AS ENUM ('OVERDUE', 'DAMAGE', 'LOST', 'OTHER');

-- CreateEnum
CREATE TYPE "FineStatus" AS ENUM ('OPEN', 'PAID', 'WAIVED', 'PARTIAL');

-- CreateTable
CREATE TABLE "CirculationPolicy" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "memberType" "MemberType" NOT NULL,
    "maxBooks" INTEGER NOT NULL,
    "loanDays" INTEGER NOT NULL,
    "renewLimit" INTEGER NOT NULL,
    "renewDays" INTEGER NOT NULL,
    "finePerDay" DECIMAL(10,2) NOT NULL,
    "graceDays" INTEGER NOT NULL,
    "maxFine" DECIMAL(10,2),
    "maxHolds" INTEGER NOT NULL,
    "holdShelfDays" INTEGER NOT NULL,
    "maxOutstandingFine" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CirculationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "copyId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),
    "renewCount" INTEGER NOT NULL DEFAULT 0,
    "issuedByUserId" UUID,
    "returnedByUserId" UUID,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hold" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "titleId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "queuePosition" INTEGER NOT NULL,
    "status" "HoldStatus" NOT NULL DEFAULT 'PENDING',
    "readyCopyId" UUID,
    "readyAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fine" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "loanId" UUID,
    "kind" "FineKind" NOT NULL,
    "status" "FineStatus" NOT NULL DEFAULT 'OPEN',
    "amount" DECIMAL(10,2) NOT NULL,
    "paidAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CirculationPolicy_orgId_idx" ON "CirculationPolicy"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CirculationPolicy_orgId_memberType_key" ON "CirculationPolicy"("orgId", "memberType");

-- CreateIndex
CREATE INDEX "Loan_orgId_idx" ON "Loan"("orgId");

-- CreateIndex
CREATE INDEX "Hold_orgId_idx" ON "Hold"("orgId");

-- CreateIndex
CREATE INDEX "Fine_orgId_idx" ON "Fine"("orgId");

-- AddForeignKey
ALTER TABLE "CirculationPolicy" ADD CONSTRAINT "CirculationPolicy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "Copy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "LibUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_returnedByUserId_fkey" FOREIGN KEY ("returnedByUserId") REFERENCES "LibUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hold" ADD CONSTRAINT "Hold_readyCopyId_fkey" FOREIGN KEY ("readyCopyId") REFERENCES "Copy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fine" ADD CONSTRAINT "Fine_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A copy can have at most ONE active loan, ever. Two desks scanning the same
-- barcode simultaneously: the loser gets a 409 from the database. Constraints
-- do not race; application check-then-write does.
CREATE UNIQUE INDEX "loan_one_active_per_copy"
  ON "Loan" ("copyId") WHERE "returnedAt" IS NULL;

-- One pending or ready hold per member per title.
CREATE UNIQUE INDEX "hold_one_pending_per_member_title"
  ON "Hold" ("memberId", "titleId") WHERE "status" IN ('PENDING', 'READY');

-- The hot read paths. "Overdue loans" is one indexed range scan over dueAt,
-- not a status scan over a column a cron has to keep fresh.
CREATE INDEX "loan_member_active" ON "Loan" ("orgId", "memberId") WHERE "returnedAt" IS NULL;
CREATE INDEX "loan_due"           ON "Loan" ("orgId", "dueAt")    WHERE "returnedAt" IS NULL;
CREATE INDEX "hold_title_queue"   ON "Hold" ("titleId", "queuePosition") WHERE "status" = 'PENDING';
CREATE INDEX "fine_member_open"   ON "Fine" ("orgId", "memberId") WHERE "status" IN ('OPEN', 'PARTIAL');
