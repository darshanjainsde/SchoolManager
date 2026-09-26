-- A festival image the school chose itself (its own murti photo, its puja
-- poster) for the festive scene. The shipped artwork for a deity is a
-- public-domain classical painting; this lets a school use its own instead.
ALTER TYPE "MediaKind" ADD VALUE IF NOT EXISTS 'FESTIVE';
