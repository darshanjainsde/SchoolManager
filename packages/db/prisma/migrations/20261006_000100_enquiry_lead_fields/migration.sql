--
-- A lead learns where it came from, who it is for, whether the family may be
-- sent a WhatsApp, and when somebody last reached them.
--
-- EXPAND ONLY. Every column is nullable or carries a DEFAULT, so the API that
-- is deployed while this runs keeps inserting website enquiries untouched, and
-- a backup taken before today restores onto this schema (the backup engine
-- refuses a NOT NULL column with no default). Nothing is dropped; Enquiry keeps
-- its tenant_iso policy — adding a column never touches a policy.
--
-- RLS: no new table. Grants: none needed.

DO $$ BEGIN
  CREATE TYPE "EnquirySource" AS ENUM ('WEBSITE', 'COURSE_CARD', 'WALK_IN', 'PHONE', 'WHATSAPP', 'REFERRAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- "updatedAt" is added NOT NULL WITH a default in the one statement: Postgres
-- fills every existing row from the default, so no UPDATE has to touch a row
-- for the constraint to hold. Enquiry is FORCE ROW LEVEL SECURITY, and a
-- migration role without BYPASSRLS sees zero rows through tenant_iso — a
-- separate back-fill + SET NOT NULL would then fail the whole run.
ALTER TABLE "Enquiry"
    ADD COLUMN IF NOT EXISTS "source"          "EnquirySource" NOT NULL DEFAULT 'WEBSITE',
    ADD COLUMN IF NOT EXISTS "childName"       TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappOk"      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "lastContactedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- BEST-EFFORT back-fill, so an old lead says when it was made rather than when
-- this migration ran. Under FORCE RLS without BYPASSRLS it may touch no rows;
-- old leads then show the migration time as their last update, which is
-- harmless. Nothing after this statement depends on it.
UPDATE "Enquiry" SET "updatedAt" = "createdAt";

-- The homepage course card has always posted with this fixed parent name,
-- because it asks for a phone number only. Those leads came from the card.
-- Best-effort in the same way: if RLS hides the rows, they stay WEBSITE.
UPDATE "Enquiry" SET "source" = 'COURSE_CARD'
 WHERE "parentName" = 'Course card lead' AND "source" = 'WEBSITE';
