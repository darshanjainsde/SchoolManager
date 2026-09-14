-- Birthdays & Celebrations (Active Roster, Track B). Additive: one homepage
-- switch (off by default) and one JSON settings blob. Safe on production
-- before the code deploys — old code ignores both columns.
ALTER TABLE "HomepageContent" ADD COLUMN "showBirthdays" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SchoolProfile" ADD COLUMN "celebrationsConfig" JSONB;
