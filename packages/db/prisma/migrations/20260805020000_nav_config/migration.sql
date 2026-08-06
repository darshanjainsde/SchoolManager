-- A school's own arrangement of its navigation.
--
-- Nullable with no default: null means "use the built-in five-control model",
-- which is what every school renders today, so this changes nothing until an
-- admin opens the editor and saves.
ALTER TABLE "SchoolProfile" ADD COLUMN "navConfig" JSONB;
