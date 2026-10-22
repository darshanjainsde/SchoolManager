-- Marketing config: hero figures + a time-boxed discount (2026-10-22).
--
-- EXPAND ONLY. Five columns on the MarketingConfig singleton, every one with
-- a default, so the existing row keeps answering exactly as before until the
-- owner console writes to it. Nothing is dropped, renamed or backfilled.
ALTER TABLE "MarketingConfig" ADD COLUMN "heroStats" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "MarketingConfig" ADD COLUMN "discountEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MarketingConfig" ADD COLUMN "discountPercent" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "MarketingConfig" ADD COLUMN "discountLabel" TEXT NOT NULL DEFAULT 'Launch offer';
ALTER TABLE "MarketingConfig" ADD COLUMN "discountEndsAt" TIMESTAMP(3);
