-- WhatsApp channel: the per-school switch and the delivery ledger.
CREATE TABLE "WhatsAppSettings" (
  "schoolId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "phoneNumberId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppSettings_pkey" PRIMARY KEY ("schoolId"),
  CONSTRAINT "WhatsAppSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "WhatsAppDelivery" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "phone" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "templateName" TEXT NOT NULL,
  "waMessageId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  CONSTRAINT "WhatsAppDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WhatsAppDelivery_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WhatsAppDelivery_waMessageId_key" ON "WhatsAppDelivery"("waMessageId");
CREATE INDEX "WhatsAppDelivery_schoolId_createdAt_idx" ON "WhatsAppDelivery"("schoolId", "createdAt");

-- Tenant isolation, the house pattern.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WhatsAppSettings','WhatsAppDelivery'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
