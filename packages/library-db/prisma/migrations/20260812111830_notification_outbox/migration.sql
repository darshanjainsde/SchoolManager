-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL', 'INAPP');

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationOutbox_orgId_sentAt_idx" ON "NotificationOutbox"("orgId", "sentAt");

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "LibraryOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The drain worker's hot read path (Phase 4, not built yet): undrained rows
-- ordered by when they're due. Partial on `sentAt IS NULL` so a drained
-- table (the overwhelming majority of rows, once Phase 4 exists) never
-- bloats this index. Hand-added — Prisma's schema DSL cannot express a
-- partial index; same shape as `loan_due` / `hold_title_queue` in the
-- circulation migration.
CREATE INDEX "notification_outbox_undrained" ON "NotificationOutbox" ("scheduledFor") WHERE "sentAt" IS NULL;

-- NOTE: `prisma migrate dev`'s diff engine generated (and this migration
-- deliberately drops) a `DROP INDEX "title_search"` /
-- `ALTER TABLE "Title" ALTER COLUMN "searchVector" DROP DEFAULT` pair here on
-- first generation. That is drift-detection noise, not a real change this
-- task intends: `Title.searchVector` is an `Unsupported("tsvector")`
-- generated column (`GENERATED ALWAYS AS (...) STORED`, hand-added in
-- 20260811190000_catalogue/migration.sql) that Prisma's schema DSL cannot
-- fully represent, so its diff engine periodically "rediscovers" a phantom
-- default/index to remove on unrelated migrations. Applying it would have
-- dropped the GIN index backing title search. Left out on purpose.
