-- Press Orders: print fulfilment. Request -> quote (price + promised date) ->
-- confirm -> printing -> dispatched -> delivered. Status/kind/action are TEXT
-- (the PressIssue.type decision); every transition writes an event row (the
-- GiftEvent decision); the quote freezes on confirmation (service-enforced
-- transition map). Both tables carry schoolId DIRECTLY and get tenant_iso
-- here; the operator desk reads them through the platform client, which is
-- BYPASSRLS by design.

CREATE TABLE "PrintOrder" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "spec" JSONB NOT NULL,
  "source" JSONB NOT NULL,
  "deliverTo" JSONB NOT NULL,
  "neededBy" DATE,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "quotePriceMinor" INTEGER,
  "promisedBy" DATE,
  "quoteNote" TEXT,
  "quotedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrintOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrintOrder_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PrintOrder_schoolId_createdAt_idx" ON "PrintOrder"("schoolId", "createdAt");
CREATE INDEX "PrintOrder_status_promisedBy_idx" ON "PrintOrder"("status", "promisedBy");

CREATE TABLE "PrintOrderEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "note" TEXT,
  "data" JSONB,
  CONSTRAINT "PrintOrderEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrintOrderEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PrintOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PrintOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PrintOrderEvent_schoolId_orderId_at_idx" ON "PrintOrderEvent"("schoolId", "orderId", "at");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PrintOrder','PrintOrderEvent'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
