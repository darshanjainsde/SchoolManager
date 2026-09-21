-- A person's own verified WhatsApp number, and the record of what they tap.
ALTER TABLE "User"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "phonePending" TEXT,
  ADD COLUMN "phoneOtpHash" TEXT,
  ADD COLUMN "phoneOtpExpiresAt" TIMESTAMP(3),
  ADD COLUMN "phoneOtpAttempts" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "User_schoolId_phone_idx" ON "User"("schoolId", "phone");

CREATE TABLE "WhatsAppInbound" (
  "id" TEXT NOT NULL,
  "schoolId" UUID,
  "phone" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "result" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppInbound_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WhatsAppInbound_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WhatsAppInbound_schoolId_createdAt_idx" ON "WhatsAppInbound"("schoolId", "createdAt");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WhatsAppInbound'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
