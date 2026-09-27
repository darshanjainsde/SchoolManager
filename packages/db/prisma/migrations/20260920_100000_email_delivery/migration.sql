-- Email delivery ledger + suppression list.
CREATE TABLE "EmailDelivery" (
  "id" UUID NOT NULL,
  "schoolId" UUID,
  "to" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "bouncedAt" TIMESTAMP(3),
  CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailDelivery_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailDelivery_providerId_key" ON "EmailDelivery"("providerId");
CREATE INDEX "EmailDelivery_schoolId_createdAt_idx" ON "EmailDelivery"("schoolId", "createdAt");

CREATE TABLE "EmailSuppression" (
  "email" TEXT NOT NULL,
  "schoolId" UUID,
  "reason" TEXT NOT NULL,
  "detail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("email"),
  CONSTRAINT "EmailSuppression_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "EmailSuppression_schoolId_idx" ON "EmailSuppression"("schoolId");

-- Tenant isolation on both. Platform rows (no schoolId) are reachable only by
-- the platform client, which is the client every reader of these tables uses;
-- the suppression list stays platform-wide by address in practice (a dead
-- mailbox is dead for every school) while a tenant-context read, should one
-- ever exist, sees only its own school's rows.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['EmailDelivery','EmailSuppression'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
