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

ALTER TABLE "Enquiry"
    ADD COLUMN IF NOT EXISTS "source"          "EnquirySource" NOT NULL DEFAULT 'WEBSITE',
    ADD COLUMN IF NOT EXISTS "childName"       TEXT,
    ADD COLUMN IF NOT EXISTS "whatsappOk"      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "lastContactedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "updatedAt"       TIMESTAMP(3);

-- Back-fill before the NOT NULL, so an old lead says when it was made rather
-- than when this migration ran.
UPDATE "Enquiry" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;

ALTER TABLE "Enquiry"
    ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN "updatedAt" SET NOT NULL;

-- The homepage course card has always posted with this fixed parent name,
-- because it asks for a phone number only. Those leads came from the card.
UPDATE "Enquiry" SET "source" = 'COURSE_CARD'
 WHERE "parentName" = 'Course card lead' AND "source" = 'WEBSITE';
