-- First-screen layout system: per-school hero layout, overlay dial, headline
-- accent, navbar style, and multi-image hero slots.
ALTER TABLE "SchoolProfile" ADD COLUMN "heroLayout" TEXT NOT NULL DEFAULT 'ILLUSTRATION';
ALTER TABLE "SchoolProfile" ADD COLUMN "heroTextAlign" TEXT NOT NULL DEFAULT 'LEFT';
ALTER TABLE "SchoolProfile" ADD COLUMN "heroOverlayStyle" TEXT NOT NULL DEFAULT 'WASH';
ALTER TABLE "SchoolProfile" ADD COLUMN "heroOverlayOpacity" INTEGER NOT NULL DEFAULT 65;
ALTER TABLE "SchoolProfile" ADD COLUMN "heroHeight" TEXT NOT NULL DEFAULT 'FULL';
ALTER TABLE "SchoolProfile" ADD COLUMN "headlineAccent" TEXT NOT NULL DEFAULT 'DRAW';
ALTER TABLE "SchoolProfile" ADD COLUMN "navStyle" TEXT NOT NULL DEFAULT 'CLASSIC';
ALTER TABLE "SchoolProfile" ADD COLUMN "navCtaLabel" TEXT NOT NULL DEFAULT 'Enquire';
ALTER TABLE "SchoolProfile" ADD COLUMN "navShowCta" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "HomepageContent" ADD COLUMN "heroImageAssetIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- Existing schools keep the look they chose under the legacy heroStyle field.
UPDATE "SchoolProfile" SET "heroLayout" = 'FULL_BLEED' WHERE "heroStyle" = 'PHOTO';
UPDATE "SchoolProfile" SET "heroLayout" = 'MINIMAL' WHERE "heroStyle" = 'MINIMAL';

-- Seed slot 1 from the existing single hero image so photo layouts have data.
UPDATE "HomepageContent" SET "heroImageAssetIds" = ARRAY["heroAssetId"]::UUID[]
  WHERE "heroAssetId" IS NOT NULL;
