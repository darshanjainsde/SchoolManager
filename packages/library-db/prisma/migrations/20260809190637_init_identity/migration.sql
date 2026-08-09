-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'MINI', 'PRO');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('SETUP', 'LIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "LibDomainType" AS ENUM ('SUBDOMAIN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "LibDomainStatus" AS ENUM ('PENDING', 'LIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "LibRole" AS ENUM ('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER');

-- CreateEnum
CREATE TYPE "MemberType" AS ENUM ('STUDENT', 'TEACHER', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "LibraryOrg" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "OrgStatus" NOT NULL DEFAULT 'SETUP',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryDomain" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "type" "LibDomainType" NOT NULL DEFAULT 'SUBDOMAIN',
    "status" "LibDomainStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgTheme" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2E3A87',
    "accentColor" TEXT NOT NULL DEFAULT '#8F671D',
    "receiptHeader" TEXT,
    "receiptFooter" TEXT,
    "memberTypeLabels" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgTheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanOverride" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "PlanOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "openTime" TEXT,
    "closeTime" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibUser" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "LibRole" NOT NULL,
    "branchIds" UUID[],
    "memberId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "homeBranchId" UUID,
    "code" TEXT NOT NULL,
    "memberType" "MemberType" NOT NULL DEFAULT 'STUDENT',
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "photoUrl" TEXT,
    "address" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "status" "MemberStatus" NOT NULL DEFAULT 'PENDING',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "membershipEndsAt" TIMESTAMP(3),
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryOrg_slug_key" ON "LibraryOrg"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryDomain_hostname_key" ON "LibraryDomain"("hostname");

-- CreateIndex
CREATE INDEX "LibraryDomain_orgId_idx" ON "LibraryDomain"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgTheme_orgId_key" ON "OrgTheme"("orgId");

-- CreateIndex
CREATE INDEX "PlanOverride_orgId_idx" ON "PlanOverride"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanOverride_orgId_key_key" ON "PlanOverride"("orgId", "key");

-- CreateIndex
CREATE INDEX "Branch_orgId_idx" ON "Branch"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_orgId_code_key" ON "Branch"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LibUser_memberId_key" ON "LibUser"("memberId");

-- CreateIndex
CREATE INDEX "LibUser_orgId_idx" ON "LibUser"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "LibUser_orgId_email_key" ON "LibUser"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "LibUser_orgId_phone_key" ON "LibUser"("orgId", "phone");

-- CreateIndex
CREATE INDEX "Member_orgId_status_idx" ON "Member"("orgId", "status");

-- CreateIndex
CREATE INDEX "Member_orgId_externalRef_idx" ON "Member"("orgId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Member_orgId_code_key" ON "Member"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_at_idx" ON "AuditLog"("orgId", "at");

-- CreateIndex
CREATE INDEX "IdempotencyKey_createdAt_idx" ON "IdempotencyKey"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_orgId_key_key" ON "IdempotencyKey"("orgId", "key");

-- AddForeignKey
ALTER TABLE "LibraryDomain" ADD CONSTRAINT "LibraryDomain_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgTheme" ADD CONSTRAINT "OrgTheme_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanOverride" ADD CONSTRAINT "PlanOverride_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibUser" ADD CONSTRAINT "LibUser_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibUser" ADD CONSTRAINT "LibUser_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_homeBranchId_fkey" FOREIGN KEY ("homeBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "LibUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
