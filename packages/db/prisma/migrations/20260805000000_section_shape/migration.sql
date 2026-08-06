-- Section shape: one control for how every band below the fold is drawn.
--
-- Defaulted to SOFT, which is exactly what every existing site already renders,
-- so applying this migration changes nothing visible until a school picks
-- something else.
ALTER TABLE "SchoolProfile" ADD COLUMN "sectionShape" TEXT NOT NULL DEFAULT 'SOFT';
