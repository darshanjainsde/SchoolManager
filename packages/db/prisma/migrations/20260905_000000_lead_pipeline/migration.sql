-- Marketing leads become a sales pipeline: more stages, follow-up scheduling,
-- and an append-only activity timeline per lead.
--
-- EXPAND ONLY. Every statement here is additive, so this migration is safe to
-- apply to a live database while the CURRENT code is still serving it, and the
-- code that follows can be rolled back afterwards without touching the database
-- again. Nothing is rewritten and nothing is dropped, so there is no step that
-- cannot be undone by simply not using it.
--
-- Grants: not needed. ALTER DEFAULT PRIVILEGES ... ON TABLES from
-- 20260703_000100_rls_and_roles already covers tables created afterwards.
-- RLS: not applicable — MarketingLead/LeadActivity are platform-scope rows
-- (like School and MarketingConfig), never tenant data.

-- ── LeadStatus: add the pipeline stages, keep every existing one ───────────
--
-- 'CLOSED' is deliberately KEPT rather than folded into 'LOST'. Removing it
-- would mean rewriting rows — irreversible — and would instantly break the
-- console that is deployed right now, which still sends CLOSED on every status
-- change. Keeping it makes this migration invisible to the running system.
--
-- The new console treats CLOSED as a legacy alias for LOST: it displays such
-- leads in the Lost column and stops offering CLOSED as a destination, so rows
-- drift off it naturally as leads are worked. Nothing has to be backfilled.
--
-- ADD VALUE is permitted inside the transaction Prisma wraps a migration in on
-- PostgreSQL 12+, provided the new value is not USED in that same transaction.
-- These statements only add; the first write of a new value happens later, from
-- application code, in its own transaction.
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'QUALIFIED';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'DEMO';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'WON';
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'LOST';

-- ── CreateEnum ────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "LeadActivityKind" AS ENUM ('NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'STAGE_CHANGE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── AlterTable ────────────────────────────────────────────────────────────
-- All nullable, or defaulted, so INSERTs from the currently-deployed code —
-- which knows none of these columns — keep succeeding untouched.
ALTER TABLE "MarketingLead"
    ADD COLUMN IF NOT EXISTS "email"           TEXT,
    ADD COLUMN IF NOT EXISTS "nextFollowUpAt"  TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "lastContactedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "updatedAt"       TIMESTAMP(3);

-- Backfill before the NOT NULL, so existing rows have a sane value rather than
-- the migration's own clock.
UPDATE "MarketingLead" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "MarketingLead"
    ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updatedAt" SET NOT NULL;

-- ── CreateTable ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LeadActivity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "leadId" UUID NOT NULL,
    "kind" "LeadActivityKind" NOT NULL,
    "body" TEXT,
    "fromStatus" "LeadStatus",
    "toStatus" "LeadStatus",
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- ── CreateIndex ───────────────────────────────────────────────────────────
-- [leadId, createdAt] is what the scoped groupBy in listLeads rides; without it
-- that aggregate degrades to the table scan the relation-_count form would have
-- done anyway. See apps/api/src/common/tenant-aggregates.spec.ts.
CREATE INDEX IF NOT EXISTS "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingLead_nextFollowUpAt_idx" ON "MarketingLead"("nextFollowUpAt");

-- ── AddForeignKey ─────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "MarketingLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
