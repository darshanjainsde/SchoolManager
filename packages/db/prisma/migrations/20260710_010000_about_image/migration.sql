-- Wide About-section image (campus/community photo), separate from the
-- principal portrait which feeds the small name chip.
ALTER TABLE "HomepageContent" ADD COLUMN "aboutImageAssetId" UUID;
ALTER TYPE "MediaKind" ADD VALUE IF NOT EXISTS 'ABOUT';
