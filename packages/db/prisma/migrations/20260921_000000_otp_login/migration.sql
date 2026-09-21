-- OTP login: a display name for every login, notification switches, the
-- E.164 copy of every phone a person may log in with, and the one-time codes.
ALTER TABLE "User"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "notifyPrefs" JSONB;

ALTER TABLE "Student" ADD COLUMN "guardianPhoneE164" TEXT;
ALTER TABLE "Teacher" ADD COLUMN "phoneE164" TEXT;
ALTER TABLE "Staff"   ADD COLUMN "phoneE164" TEXT;

-- Back-fill from the raw office-typed numbers. Indian default: the last ten
-- digits when they form a mobile number (6–9 first), optionally prefixed by
-- 0 or 91. Anything else stays NULL and the office fixes it on the record.
UPDATE "Student" SET "guardianPhoneE164" = '+91' || right(regexp_replace("guardianPhone", '\D', '', 'g'), 10)
  WHERE "guardianPhone" IS NOT NULL AND regexp_replace("guardianPhone", '\D', '', 'g') ~ '^(0|91)?[6-9][0-9]{9}$';
UPDATE "Teacher" SET "phoneE164" = '+91' || right(regexp_replace("phone", '\D', '', 'g'), 10)
  WHERE "phone" IS NOT NULL AND regexp_replace("phone", '\D', '', 'g') ~ '^(0|91)?[6-9][0-9]{9}$';
UPDATE "Staff" SET "phoneE164" = '+91' || right(regexp_replace("phone", '\D', '', 'g'), 10)
  WHERE "phone" IS NOT NULL AND regexp_replace("phone", '\D', '', 'g') ~ '^(0|91)?[6-9][0-9]{9}$';

CREATE INDEX "Student_guardianPhoneE164_idx" ON "Student"("guardianPhoneE164");
CREATE INDEX "Student_schoolId_guardianPhoneE164_idx" ON "Student"("schoolId", "guardianPhoneE164");
CREATE INDEX "Teacher_phoneE164_idx" ON "Teacher"("phoneE164");
CREATE INDEX "Staff_phoneE164_idx" ON "Staff"("phoneE164");

CREATE TABLE "OtpChallenge" (
  "id" UUID NOT NULL,
  "phone" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "sentVia" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "schoolId" UUID,
  "userId" UUID,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OtpChallenge_phone_purpose_createdAt_idx" ON "OtpChallenge"("phone", "purpose", "createdAt");
