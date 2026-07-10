-- Platform-level marketing tables + owner→admin impersonation tokens.
-- No RLS: these are platform-scope (like "School"), never tenant data.

CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

CREATE TABLE "MarketingLead" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "school" TEXT,
    "interest" TEXT,
    "source" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketingLead_status_createdAt_idx" ON "MarketingLead"("status", "createdAt");

CREATE TABLE "MarketingConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "priceBasicUsd" INTEGER NOT NULL DEFAULT 19,
    "priceBasicInr" INTEGER NOT NULL DEFAULT 999,
    "priceStdUsd" INTEGER NOT NULL DEFAULT 49,
    "priceStdInr" INTEGER NOT NULL DEFAULT 2499,
    "priceProUsd" INTEGER NOT NULL DEFAULT 99,
    "priceProInr" INTEGER NOT NULL DEFAULT 4999,
    "contactEmail" TEXT NOT NULL DEFAULT 'admin@sckools.com',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImpersonationToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImpersonationToken_tokenHash_key" ON "ImpersonationToken"("tokenHash");
CREATE INDEX "ImpersonationToken_userId_idx" ON "ImpersonationToken"("userId");

ALTER TABLE "ImpersonationToken" ADD CONSTRAINT "ImpersonationToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
