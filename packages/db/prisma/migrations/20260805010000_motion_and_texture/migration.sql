-- The rest of the customisation increment: a motion GESTURE (what a section
-- does as it arrives) and a background texture.
--
-- Both default to what every site already renders — RISE is today's reveal and
-- NONE is today's plain paper — so applying this changes nothing until a school
-- picks otherwise.
ALTER TABLE "SchoolProfile" ADD COLUMN "motionGesture" TEXT NOT NULL DEFAULT 'RISE';
ALTER TABLE "SchoolProfile" ADD COLUMN "backgroundTexture" TEXT NOT NULL DEFAULT 'NONE';
