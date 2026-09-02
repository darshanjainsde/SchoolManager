-- The gift journey: what a donor can watch, and what the school can show.
--
-- A pledge used to carry a status and nothing else, which answers "where is it"
-- and never "what happened". For somebody who handed over money months ago the
-- second question is the whole point, so this adds the history, the proof, and
-- the logistics the two tracks actually need.

-- CreateEnum
CREATE TYPE "GiftAttachmentKind" AS ENUM ('BILL', 'CONSIGNMENT', 'DISTRIBUTION');

-- AlterTable: what the donor typed, where to collect it, where it got to, and
-- the school's word back.
ALTER TABLE "GiftPledge"
  ADD COLUMN "unitPriceMinor"    INTEGER,
  ADD COLUMN "pickupAddress"     TEXT,
  ADD COLUMN "pickupContact"     TEXT,
  ADD COLUMN "pickupPhone"       TEXT,
  ADD COLUMN "pickupNote"        TEXT,
  ADD COLUMN "pickupRequestedAt" TIMESTAMP(3),
  ADD COLUMN "courier"           TEXT,
  ADD COLUMN "trackingRef"       TEXT,
  ADD COLUMN "pickedUpAt"        TIMESTAMP(3),
  ADD COLUMN "purchasedAt"       TIMESTAMP(3),
  ADD COLUMN "thankYouNote"      TEXT,
  ADD COLUMN "thankYouAt"        TIMESTAMP(3),
  ADD COLUMN "thankYouByUserId"  UUID;

-- CreateTable
CREATE TABLE "GiftAttachment" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "pledgeId" UUID NOT NULL,
    "kind" "GiftAttachmentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "byUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftEvent" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "pledgeId" UUID NOT NULL,
    "status" "GiftStatus" NOT NULL,
    "note" TEXT,
    "byUserId" UUID,
    "byAlumniId" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GiftAttachment_schoolId_pledgeId_idx" ON "GiftAttachment"("schoolId", "pledgeId");
CREATE INDEX "GiftAttachment_pledgeId_kind_idx" ON "GiftAttachment"("pledgeId", "kind");
CREATE INDEX "GiftEvent_schoolId_pledgeId_idx" ON "GiftEvent"("schoolId", "pledgeId");
CREATE INDEX "GiftEvent_pledgeId_at_idx" ON "GiftEvent"("pledgeId", "at");

-- AddForeignKey
ALTER TABLE "GiftAttachment" ADD CONSTRAINT "GiftAttachment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftAttachment" ADD CONSTRAINT "GiftAttachment_pledgeId_fkey" FOREIGN KEY ("pledgeId") REFERENCES "GiftPledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftEvent" ADD CONSTRAINT "GiftEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GiftEvent" ADD CONSTRAINT "GiftEvent_pledgeId_fkey" FOREIGN KEY ("pledgeId") REFERENCES "GiftPledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security. Compared as TEXT so a pooled connection that has not set
-- app.current_tenant reads '' and fails closed, rather than raising a cast
-- error that some caller might treat as a transient fault.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "GiftAttachment" ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'ALTER TABLE "GiftAttachment" FORCE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_iso ON "GiftAttachment";';
  EXECUTE 'CREATE POLICY tenant_iso ON "GiftAttachment" USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));';

  EXECUTE 'ALTER TABLE "GiftEvent" ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'ALTER TABLE "GiftEvent" FORCE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_iso ON "GiftEvent";';
  EXECUTE 'CREATE POLICY tenant_iso ON "GiftEvent" USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));';
END $$;
