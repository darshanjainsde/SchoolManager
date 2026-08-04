-- Event registrations, ticket types, and a payment record with no gateway
-- behind it yet.
--
-- The payment table is built now, empty, on purpose: an admin recording cash
-- at the office writes `provider = 'MANUAL'`, and the day a gateway arrives it
-- writes the same row. Nothing above this table has to move.

CREATE TYPE "RegistrationStatus" AS ENUM ('HELD', 'CONFIRMED', 'WAITLISTED', 'DECLINED', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'REFUNDED');

CREATE TABLE "EventTicketType" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventId"      UUID NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE,
  "schoolId"     UUID NOT NULL,
  "name"         TEXT NOT NULL,
  "priceMinor"   INTEGER NOT NULL DEFAULT 0,
  "currency"     TEXT NOT NULL DEFAULT 'INR',
  "capacity"     INTEGER,
  "salesOpenAt"  TIMESTAMP(3),
  "salesCloseAt" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EventTicketType_eventId_idx"  ON "EventTicketType"("eventId");
CREATE INDEX "EventTicketType_schoolId_idx" ON "EventTicketType"("schoolId");

-- Money is never negative, and a capacity of -1 is not "unlimited" (NULL is).
-- Enforced here rather than only in the service, because the service is not the
-- only thing that will ever write this table.
ALTER TABLE "EventTicketType" ADD CONSTRAINT "EventTicketType_priceMinor_nonneg" CHECK ("priceMinor" >= 0);
ALTER TABLE "EventTicketType" ADD CONSTRAINT "EventTicketType_capacity_nonneg"   CHECK ("capacity" IS NULL OR "capacity" >= 0);

CREATE TABLE "EventRegistration" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventId"       UUID NOT NULL REFERENCES "Event"("id") ON DELETE CASCADE,
  -- The HOST school. Not the registrant's. This is what RLS scopes on, and it
  -- is the single decision that keeps one school out of another's attendees.
  "schoolId"      UUID NOT NULL,
  "ticketTypeId"  UUID NOT NULL REFERENCES "EventTicketType"("id") ON DELETE RESTRICT,
  "quantity"      INTEGER NOT NULL DEFAULT 1,
  "studentId"     UUID,
  -- Which school the registrant came from. NOT derivable from "schoolId",
  -- which is the host — for a network event these differ, and which school
  -- someone is from is the first thing an admin asks about the row.
  "fromSchoolId"  UUID,
  "guestName"     TEXT,
  "guestEmail"    TEXT,
  "guestPhone"    TEXT,
  "status"        "RegistrationStatus" NOT NULL DEFAULT 'HELD',
  "amountMinor"   INTEGER NOT NULL DEFAULT 0,
  "currency"      TEXT NOT NULL DEFAULT 'INR',
  "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "waitlistPos"   INTEGER,
  "checkedInAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One place per student per event. A family needing two seats uses `quantity`;
-- a second row would make capacity uncountable. Partial, so the many guest
-- rows (studentId NULL) are not forced unique against each other.
CREATE UNIQUE INDEX "EventRegistration_event_student_key"
  ON "EventRegistration"("eventId", "studentId") WHERE "studentId" IS NOT NULL;
CREATE INDEX "EventRegistration_school_event_idx" ON "EventRegistration"("schoolId", "eventId");
CREATE INDEX "EventRegistration_event_status_idx" ON "EventRegistration"("eventId", "status");
CREATE INDEX "EventRegistration_fromSchool_idx"   ON "EventRegistration"("fromSchoolId");

ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_quantity_positive" CHECK ("quantity" >= 1);
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_amount_nonneg"     CHECK ("amountMinor" >= 0);
-- A registration must identify SOMEBODY. Without this a row can exist that no
-- admin can act on and no registrant can be told about.
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_has_registrant"
  CHECK ("studentId" IS NOT NULL OR "guestEmail" IS NOT NULL);

CREATE TABLE "EventPayment" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "registrationId" UUID NOT NULL REFERENCES "EventRegistration"("id") ON DELETE CASCADE,
  "schoolId"       UUID NOT NULL,
  "provider"       TEXT NOT NULL DEFAULT 'MANUAL',
  "providerRef"    TEXT,
  "amountMinor"    INTEGER NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'INR',
  "status"         "PaymentStatus" NOT NULL DEFAULT 'PAID',
  "recordedBy"     UUID,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EventPayment_schoolId_idx"       ON "EventPayment"("schoolId");
CREATE INDEX "EventPayment_registrationId_idx" ON "EventPayment"("registrationId");

-- ── Row level security ──────────────────────────────────────────────────────
--
-- Ticket types and payments are plain tenant-isolated: they belong to the host
-- and nobody else reads them.
ALTER TABLE "EventTicketType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventTicketType" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "EventTicketType"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

-- A ticket type must be readable by anyone who can see the event, or a visitor
-- from another school cannot be shown the price of a network event they are
-- allowed to register for. Read only, and only for events that are already
-- public network-wide — the same condition Event's own read_network_events uses.
CREATE POLICY read_network_ticket_types ON "EventTicketType" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "Event" e
    WHERE e."id" = "EventTicketType"."eventId"
      AND e."scope" = 'NETWORK'
      AND e."status" = 'APPROVED'
  ));

ALTER TABLE "EventPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventPayment" FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "EventPayment"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

-- Registrations are the hard one.
--
-- A student of school A registering for school B's NETWORK event writes a row
-- whose "schoolId" is B, while the connection is authenticated as A. Plain
-- tenant isolation refuses that insert, which is correct for every other table
-- in this database and wrong for this one.
--
-- So: the host reads and writes its own rows as usual (tenant_iso), and there
-- is ONE extra INSERT policy, deliberately narrow.
ALTER TABLE "EventRegistration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventRegistration" FORCE  ROW LEVEL SECURITY;

-- The host owns its attendee list: full read/write on its own rows.
CREATE POLICY tenant_iso ON "EventRegistration"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

-- Cross-school insert. Every clause here is load-bearing:
--   * FOR INSERT only — this grants no ability to READ another school's
--     attendee list, which is the thing that must never leak.
--   * the target event must be NETWORK and APPROVED, so a school's private
--     events are not registerable by outsiders.
--   * "fromSchoolId" must be the CURRENT tenant, so a caller cannot write a row
--     claiming to be from a school they are not authenticated as.
--   * "schoolId" must equal the event's owner, so the row cannot be filed under
--     a school that is not hosting.
CREATE POLICY register_for_network_event ON "EventRegistration" FOR INSERT
  WITH CHECK (
    "fromSchoolId"::text = current_setting('app.current_tenant', true)
    AND EXISTS (
      SELECT 1 FROM "Event" e
      WHERE e."id" = "EventRegistration"."eventId"
        AND e."scope" = 'NETWORK'
        AND e."status" = 'APPROVED'
        AND e."schoolId" = "EventRegistration"."schoolId"
    )
  );

-- Read-back of one's own outbound registrations, so a student can be shown
-- "you are registered" for an event hosted elsewhere. Scoped to rows the
-- caller's own school produced — never the host's full list.
CREATE POLICY read_own_outbound_registrations ON "EventRegistration" FOR SELECT
  USING ("fromSchoolId"::text = current_setting('app.current_tenant', true));
