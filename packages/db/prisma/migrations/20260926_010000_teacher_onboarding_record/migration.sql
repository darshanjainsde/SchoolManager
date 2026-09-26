-- ═══════════════════════════════════════════════════════════════════════════
-- TEACHER ONBOARDING RECORD
--
-- Creating a teacher took two names and an email. What a school actually
-- keeps on file — and what an inspection asks for — is the post and its
-- qualification (CBSE Affiliation Bye-laws), TET status for anyone teaching
-- classes I–VIII (RTE s.23 / NCTE), joining date and employment type, the
-- safety checks (police verification, POCSO awareness), an emergency contact,
-- and the WhatsApp number that updates and actions go to.
--
-- Every column is nullable: quick-add stays two names. Enumerated values are
-- TEXT validated at write time (the Student.category pattern), so adding a
-- designation is a list entry rather than a migration.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "Teacher"
  ADD COLUMN IF NOT EXISTS "gender"                    TEXT,
  ADD COLUMN IF NOT EXISTS "dob"                       DATE,
  ADD COLUMN IF NOT EXISTS "bloodGroup"                TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappPhone"             TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappPhoneE164"         TEXT,
  ADD COLUMN IF NOT EXISTS "whatsappOptIn"             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "employeeCode"              TEXT,
  ADD COLUMN IF NOT EXISTS "designation"               TEXT,
  ADD COLUMN IF NOT EXISTS "department"                TEXT,
  ADD COLUMN IF NOT EXISTS "employmentType"            TEXT,
  ADD COLUMN IF NOT EXISTS "joinedOn"                  DATE,
  ADD COLUMN IF NOT EXISTS "highestQualification"      TEXT,
  ADD COLUMN IF NOT EXISTS "professionalQualification" TEXT,
  ADD COLUMN IF NOT EXISTS "tetStatus"                 TEXT,
  ADD COLUMN IF NOT EXISTS "tetCertificateNo"          TEXT,
  ADD COLUMN IF NOT EXISTS "tetValidTill"              DATE,
  ADD COLUMN IF NOT EXISTS "specialisation"            TEXT,
  ADD COLUMN IF NOT EXISTS "experienceYears"           INTEGER,
  ADD COLUMN IF NOT EXISTS "previousSchool"            TEXT,
  ADD COLUMN IF NOT EXISTS "addressLine1"              TEXT,
  ADD COLUMN IF NOT EXISTS "addressLine2"              TEXT,
  ADD COLUMN IF NOT EXISTS "city"                      TEXT,
  ADD COLUMN IF NOT EXISTS "region"                    TEXT,
  ADD COLUMN IF NOT EXISTS "postalCode"                TEXT,
  ADD COLUMN IF NOT EXISTS "emergencyContactName"      TEXT,
  ADD COLUMN IF NOT EXISTS "emergencyContactPhone"     TEXT,
  ADD COLUMN IF NOT EXISTS "emergencyContactRelation"  TEXT,
  ADD COLUMN IF NOT EXISTS "policeVerification"        TEXT,
  ADD COLUMN IF NOT EXISTS "policeVerifiedOn"          DATE,
  ADD COLUMN IF NOT EXISTS "medicalFitnessOn"          DATE,
  ADD COLUMN IF NOT EXISTS "pocsoTrainedOn"            DATE;

-- The WhatsApp number is what an inbound action resolves a teacher by.
CREATE INDEX IF NOT EXISTS "Teacher_whatsappPhoneE164_idx" ON "Teacher"("whatsappPhoneE164");
