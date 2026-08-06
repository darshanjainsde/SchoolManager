-- How the sign-in control is drawn.
--
-- Defaults to LINK, which is exactly what every school renders today, so this
-- changes nothing until an admin picks otherwise.
ALTER TABLE "SchoolProfile" ADD COLUMN "navLoginStyle" TEXT NOT NULL DEFAULT 'LINK';
