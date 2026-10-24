-- The Support Desk: a school admin reports a problem with Sckools itself, the
-- owner answers it school-wise, the school watches every move.
-- Spec: docs/superpowers/specs/2026-10-24-support-desk-design.md
--
-- "number" is one global SERIAL (SK-000142): the owner talks about tickets
-- across schools, so a per-school counter would collide in conversation.
CREATE TABLE "SupportTicket" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "number" SERIAL NOT NULL,
  "raisedById" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "attachmentKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "context" JSONB,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "assignedOwnerId" UUID,
  "lookInUntil" TIMESTAMP(3),
  "externalRef" TEXT,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "reopenedAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSchoolActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastOwnerActivityAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportTicket_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportTicket_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SupportTicket_number_key" ON "SupportTicket"("number");
CREATE INDEX "SupportTicket_schoolId_status_lastActivityAt_idx" ON "SupportTicket"("schoolId", "status", "lastActivityAt");
-- The owner's board reads every school at once.
CREATE INDEX "SupportTicket_status_lastActivityAt_idx" ON "SupportTicket"("status", "lastActivityAt");
-- Indexed for the referential-integrity check Postgres runs on a parent
-- delete: that check never sees a tenant predicate (2026-09-21 tenancy audit).
CREATE INDEX "SupportTicket_raisedById_idx" ON "SupportTicket"("raisedById");

-- One timeline per ticket: a reply the school sees, a private owner note, a
-- status move, or a system line — one ordered story.
CREATE TABLE "SupportTicketEntry" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "authorId" UUID,
  "authorKind" TEXT NOT NULL,
  "authorName" TEXT,
  "body" TEXT NOT NULL,
  "attachmentKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "visibleToSchool" BOOLEAN NOT NULL DEFAULT true,
  "statusFrom" TEXT,
  "statusTo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicketEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportTicketEntry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportTicketEntry_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportTicketEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SupportTicketEntry_schoolId_ticketId_createdAt_idx" ON "SupportTicketEntry"("schoolId", "ticketId", "createdAt");
CREATE INDEX "SupportTicketEntry_ticketId_idx" ON "SupportTicketEntry"("ticketId");
CREATE INDEX "SupportTicketEntry_authorId_idx" ON "SupportTicketEntry"("authorId");

-- Tenant isolation, the house pattern: app_current_tenant() with no cast on
-- either side, so "schoolId" stays usable as an index condition.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SupportTicket','SupportTicketEntry'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('CREATE POLICY tenant_iso ON %I USING ("schoolId" = app_current_tenant()) WITH CHECK ("schoolId" = app_current_tenant());', t);
  END LOOP;
END $$;
