-- Notification spine, Tier 1: one delivery row per (outbox row, person, channel).
--
-- The outbox row stays the unit a writer creates; the drain expands it into
-- these rows and each one retries on its own. A WhatsApp rate limit for one
-- parent can no longer resend a whole class's push and email.
ALTER TABLE "NotificationOutbox" ADD COLUMN "expandedAt" TIMESTAMP(3);

CREATE TABLE "NotificationDelivery" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "outboxId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "reason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "error" TEXT,
  "providerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationDelivery_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationDelivery_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "NotificationOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- The unique index leads with outboxId, so it also serves the FK check and
-- the drain's "does this row still have work" probe.
CREATE UNIQUE INDEX "NotificationDelivery_outboxId_userId_channel_key" ON "NotificationDelivery"("outboxId", "userId", "channel");
CREATE INDEX "NotificationDelivery_schoolId_createdAt_idx" ON "NotificationDelivery"("schoolId", "createdAt");
-- The drain's own claim: due rows, soonest first.
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_userId_createdAt_idx" ON "NotificationDelivery"("userId", "createdAt");

-- Tenant isolation, the house pattern. The drain reads through the platform
-- client (BYPASSRLS) with an explicit schoolId; a tenant session sees only its own.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['NotificationDelivery'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('CREATE POLICY tenant_iso ON %I USING ("schoolId" = app_current_tenant()) WITH CHECK ("schoolId" = app_current_tenant());', t);
  END LOOP;
END $$;
