-- Sports wing: the Book of Records on the public website (switch, consent,
-- name format, page layout, homepage scope). Normalised on read by
-- cms/internal/records-config.ts; null = every default (off).
ALTER TABLE "SchoolProfile" ADD COLUMN "recordsConfig" JSONB;
