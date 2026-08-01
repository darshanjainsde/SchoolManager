-- In-app notification inbox (the bell + unread count) for both portals.
-- DISTINCT from NotificationOutbox (a push-delivery queue): this table persists
-- one row per recipient per event with a `readAt` read-receipt the bell counts
-- against. Direct "schoolId" -> standard tenant RLS (pattern copied verbatim
-- from 20260731000000_messaging). "userId" is a BARE scalar with NO foreign
-- key, mirroring PushToken.userId (see schema.prisma): a hard user delete
-- orphans only harmless unread rows, and the schoolId cascade still clears them
-- when a school is removed.

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "linkType" TEXT,
    "linkId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the bell's hot path — unread count + unread list for one user.
CREATE INDEX "Notification_schoolId_userId_readAt_idx" ON "Notification"("schoolId", "userId", "readAt");

-- CreateIndex: newest-first list for the paginated notification screen.
CREATE INDEX "Notification_schoolId_userId_createdAt_idx" ON "Notification"("schoolId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: own-tenant read/write via the direct "schoolId". GRANTs are covered by
-- the ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES set up in
-- 20260703_000100_rls_and_roles for every table created afterwards.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Notification'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
