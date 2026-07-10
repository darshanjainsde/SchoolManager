-- Per-school control of which sections render on the homepage; full details
-- always available on the dedicated pages (/admissions, /gallery, /connect, /contact).
ALTER TABLE "HomepageContent" ADD COLUMN "showAdmissions" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HomepageContent" ADD COLUMN "showGallery" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HomepageContent" ADD COLUMN "showEvents" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HomepageContent" ADD COLUMN "showContact" BOOLEAN NOT NULL DEFAULT true;
