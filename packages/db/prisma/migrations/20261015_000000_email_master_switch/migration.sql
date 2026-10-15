-- Email master switch: a school can turn ALL its email off (a test school whose
-- made-up addresses would only bounce back to the sender's inbox).
--
-- EXPAND ONLY. NOT NULL with a constant default is a metadata-only change on
-- Postgres 11+ (no table rewrite, no long lock), and every existing school
-- keeps sending exactly as before (true).
ALTER TABLE "EmailSettings" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
