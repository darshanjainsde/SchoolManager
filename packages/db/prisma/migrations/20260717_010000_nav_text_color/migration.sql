-- Text colour for the transparent (GHOST) navbar before scroll.
-- AUTO derives from the hero overlay: paper wash → dark ink, tint/dark → white.
ALTER TABLE "SchoolProfile" ADD COLUMN "navTextColor" TEXT NOT NULL DEFAULT 'AUTO';
