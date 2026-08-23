-- Letterhead: per-school email identity.
--
-- Purely additive. No existing row, column or constraint is touched, so a
-- school with no row here keeps working exactly as before — its mail simply
-- renders with the name, logo and colour it already set for its website.

CREATE TYPE "EmailSenderMode" AS ENUM ('DEFAULT', 'CUSTOM');
CREATE TYPE "EmailSenderStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'FAILING');

CREATE TABLE "EmailSettings" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId"     UUID NOT NULL,

  -- Letterhead
  "template"     TEXT NOT NULL DEFAULT 'CLASSIC',
  "senderName"   TEXT,
  "replyTo"      TEXT,
  "accentColor"  TEXT,
  "logoAssetId"  UUID,
  "footerLines"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Own sender (only used once VERIFIED)
  "senderMode"   "EmailSenderMode"   NOT NULL DEFAULT 'DEFAULT',
  "senderStatus" "EmailSenderStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "fromAddress"  TEXT,
  "smtpHost"     TEXT,
  "smtpPort"     INTEGER,
  "smtpUser"     TEXT,
  -- AES-256-GCM ciphertext; the key lives only in the environment.
  "smtpPassEnc"  TEXT,
  "verifiedAt"   TIMESTAMP(3),
  "lastError"    TEXT,
  "lastErrorAt"  TIMESTAMP(3),

  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EmailSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailSettings_schoolId_key" ON "EmailSettings"("schoolId");

ALTER TABLE "EmailSettings"
  ADD CONSTRAINT "EmailSettings_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same tenant isolation as every other per-school table. The mail sender reads
-- this through the BYPASSRLS platform role (delivery happens post-commit,
-- outside any tenant transaction); the admin console writes it through the
-- tenant role, which this policy binds.
ALTER TABLE "EmailSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailSettings" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "EmailSettings"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
