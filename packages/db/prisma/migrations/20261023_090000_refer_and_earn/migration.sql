-- Refer & Earn (2026-10-23): promoters, referrals, payouts, owner tasks, and
-- the programme's settings on the platform config row.
--
-- EXPAND ONLY. New tables and five defaulted columns on MarketingConfig.
-- Platform data: every new table gets RLS enabled with a deny-all policy, the
-- OtpChallenge pattern, so the Supabase Data API sees nothing and only the
-- platform (BYPASSRLS) client the API uses can read or write it.

ALTER TABLE "MarketingConfig" ADD COLUMN "referralLadder" JSONB NOT NULL DEFAULT '{"1-2":8,"3-5":10,"6-10":12,"10+":15}';
ALTER TABLE "MarketingConfig" ADD COLUMN "referralCapMinor" INTEGER NOT NULL DEFAULT 5000000;
ALTER TABLE "MarketingConfig" ADD COLUMN "referralPayoutDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "MarketingConfig" ADD COLUMN "referralAttributionDays" INTEGER NOT NULL DEFAULT 90;
ALTER TABLE "MarketingConfig" ADD COLUMN "referralTdsPct" INTEGER NOT NULL DEFAULT 2;

CREATE TYPE "PromoterStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');
CREATE TYPE "ReferralStatus" AS ENUM ('LOGGED', 'ACCEPTED', 'CONTACTED', 'DEMO_DONE', 'PROPOSAL_SENT', 'WON', 'LIVE', 'PAYOUT_DUE', 'PAID', 'REJECTED', 'LOST');
CREATE TYPE "ReferralTaskKind" AS ENUM ('COMMISSION', 'REFERRAL', 'KYC');
CREATE TYPE "ReferralTaskStatus" AS ENUM ('OPEN', 'DONE');
CREATE TYPE "ReferralPayoutStatus" AS ENUM ('DUE', 'PAID', 'ON_HOLD');
CREATE TYPE "ReferralEventActor" AS ENUM ('PROMOTER', 'OWNER', 'SYSTEM');

CREATE TABLE "Promoter" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phoneE164" TEXT,
    "city" TEXT,
    "status" "PromoterStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "who" TEXT,
    "expect" TEXT,
    "areas" TEXT,
    "know" TEXT,
    "schoolsInMind" TEXT,
    "hasGst" BOOLEAN NOT NULL DEFAULT false,
    "questionnaireAt" TIMESTAMP(3),
    "commissionPct" INTEGER,
    "commissionCapMinor" INTEGER,
    "commissionNote" TEXT,
    "commissionSetAt" TIMESTAMP(3),
    "payeeName" TEXT,
    "pan" TEXT,
    "bankAccount" TEXT,
    "ifsc" TEXT,
    "upi" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "payoutDetailsAt" TIMESTAMP(3),
    "kycVerifiedAt" TIMESTAMP(3),
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Promoter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Promoter_code_key" ON "Promoter"("code");
CREATE UNIQUE INDEX "Promoter_email_key" ON "Promoter"("email");
CREATE UNIQUE INDEX "Promoter_phoneE164_key" ON "Promoter"("phoneE164");
CREATE INDEX "Promoter_status_createdAt_idx" ON "Promoter"("status", "createdAt");
CREATE INDEX "Promoter_city_idx" ON "Promoter"("city");

CREATE TABLE "Referral" (
    "id" UUID NOT NULL,
    "promoterId" UUID NOT NULL,
    "leadId" UUID,
    "wonSchoolId" UUID,
    "schoolName" TEXT NOT NULL,
    "schoolKey" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "area" TEXT,
    "studentsApprox" INTEGER,
    "board" TEXT,
    "contactName" TEXT NOT NULL,
    "contactRole" TEXT,
    "contactPhone" TEXT NOT NULL,
    "contactPhoneKey" TEXT NOT NULL,
    "contactEmail" TEXT,
    "planInterest" TEXT,
    "howKnown" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "viaLink" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReferralStatus" NOT NULL DEFAULT 'LOGGED',
    "statusReason" TEXT,
    "attributionUntil" TIMESTAMP(3) NOT NULL,
    "invoiceMinor" INTEGER,
    "rewardMinor" INTEGER,
    "liveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Referral_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Promoter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Referral_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketingLead"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Referral_leadId_key" ON "Referral"("leadId");
CREATE INDEX "Referral_promoterId_createdAt_idx" ON "Referral"("promoterId", "createdAt");
CREATE INDEX "Referral_status_createdAt_idx" ON "Referral"("status", "createdAt");
CREATE INDEX "Referral_schoolKey_idx" ON "Referral"("schoolKey");
CREATE INDEX "Referral_contactPhoneKey_idx" ON "Referral"("contactPhoneKey");
CREATE INDEX "Referral_city_idx" ON "Referral"("city");

CREATE TABLE "ReferralEvent" (
    "id" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "actor" "ReferralEventActor" NOT NULL,
    "fromStatus" "ReferralStatus",
    "toStatus" "ReferralStatus",
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReferralEvent_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReferralEvent_referralId_createdAt_idx" ON "ReferralEvent"("referralId", "createdAt");

CREATE TABLE "ReferralPayout" (
    "id" UUID NOT NULL,
    "promoterId" UUID NOT NULL,
    "referralId" UUID NOT NULL,
    "grossMinor" INTEGER NOT NULL,
    "tdsMinor" INTEGER NOT NULL,
    "netMinor" INTEGER NOT NULL,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "status" "ReferralPayoutStatus" NOT NULL DEFAULT 'DUE',
    "utr" TEXT,
    "paidOn" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferralPayout_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReferralPayout_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Promoter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReferralPayout_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReferralPayout_referralId_key" ON "ReferralPayout"("referralId");
CREATE INDEX "ReferralPayout_status_dueOn_idx" ON "ReferralPayout"("status", "dueOn");
CREATE INDEX "ReferralPayout_promoterId_idx" ON "ReferralPayout"("promoterId");

CREATE TABLE "ReferralTask" (
    "id" UUID NOT NULL,
    "kind" "ReferralTaskKind" NOT NULL,
    "status" "ReferralTaskStatus" NOT NULL DEFAULT 'OPEN',
    "promoterId" UUID NOT NULL,
    "referralId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    CONSTRAINT "ReferralTask_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReferralTask_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Promoter"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReferralTask_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReferralTask_status_createdAt_idx" ON "ReferralTask"("status", "createdAt");
CREATE INDEX "ReferralTask_promoterId_kind_status_idx" ON "ReferralTask"("promoterId", "kind", "status");

-- Platform-only: RLS on, and a policy that admits nobody,
-- so only the BYPASSRLS platform role the API uses can touch these rows.
ALTER TABLE "Promoter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON "Promoter" USING (false) WITH CHECK (false);
ALTER TABLE "Referral" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON "Referral" USING (false) WITH CHECK (false);
ALTER TABLE "ReferralEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON "ReferralEvent" USING (false) WITH CHECK (false);
ALTER TABLE "ReferralPayout" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON "ReferralPayout" USING (false) WITH CHECK (false);
ALTER TABLE "ReferralTask" ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_only ON "ReferralTask" USING (false) WITH CHECK (false);

-- One holder per school: a second LOGGED row for a school that is held cannot
-- be inserted even if two promoters log it in the same instant. Closed rows
-- (REJECTED, LOST) do not hold, so a school can be referred again.
CREATE UNIQUE INDEX "Referral_held_school_key" ON "Referral"("schoolKey")
  WHERE "status" IN ('LOGGED','ACCEPTED','CONTACTED','DEMO_DONE','PROPOSAL_SENT','WON','LIVE','PAYOUT_DUE','PAID');
