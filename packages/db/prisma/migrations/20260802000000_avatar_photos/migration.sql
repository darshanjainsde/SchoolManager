-- Phase 5·0d: self-uploaded profile photos ("paste a photo in the diary").
-- AVATAR joins the MediaKind taxonomy (distinct from STAFF, the CMS
-- featured-staff imagery), and Staff gains the same bare-scalar photoAssetId
-- that Student/Teacher already carry. PG12+ allows ADD VALUE in a transaction
-- as long as the new value isn't used in the same transaction — it isn't.

ALTER TYPE "MediaKind" ADD VALUE IF NOT EXISTS 'AVATAR';

ALTER TABLE "Staff" ADD COLUMN "photoAssetId" UUID;
