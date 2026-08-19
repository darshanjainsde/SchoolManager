-- A custom page can be footer-only: reachable from the footer's link list but
-- not the navbar, so a secondary page (Privacy, Careers, Alumni) need not
-- spend one of the six navbar slots.
--
-- Default true keeps every existing page in the navbar exactly as before.
ALTER TABLE "SchoolPage" ADD COLUMN "showInNav" BOOLEAN NOT NULL DEFAULT true;
