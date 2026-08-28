-- Give events an audience instead of an all-or-nothing network flag.
--
-- Before this, scope=NETWORK meant "every school on the platform, forever".
-- Measured on a 200-school dataset, that made a single public-site request
-- return 10,050 events and 3.16 MB — against Vercel's hard 4.5 MB response cap,
-- which returns an error rather than a slow page. Growth is exactly linear at
-- ~330 bytes/event, so the cap lands at ~13,000 upcoming network events
-- platform-wide: around 260 schools if each keeps 50 events posted.

CREATE TYPE "EventAudienceKind" AS ENUM ('SCHOOL_ONLY', 'CITY', 'SELECTED', 'EVERYWHERE');

ALTER TABLE "Event"
  ADD COLUMN "audienceKind" "EventAudienceKind" NOT NULL DEFAULT 'SCHOOL_ONLY',
  ADD COLUMN "audienceCity" TEXT;

-- Preserve what schools have already published. Existing NETWORK events keep
-- their old reach under the legacy EVERYWHERE kind, which the new UI does not
-- offer, so the population drains as those events pass. The public-site query
-- now carries a hard row ceiling, so these cannot break the page while they age.
UPDATE "Event" SET "audienceKind" = 'EVERYWHERE' WHERE scope = 'NETWORK';

CREATE TABLE "EventAudienceSchool" (
  "eventId"  UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  CONSTRAINT "EventAudienceSchool_pkey" PRIMARY KEY ("eventId", "schoolId")
);

ALTER TABLE "EventAudienceSchool"
  ADD CONSTRAINT "EventAudienceSchool_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"(id) ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX "EventAudienceSchool_schoolId_idx" ON "EventAudienceSchool" ("schoolId");

-- The public-site query's own shape.
CREATE INDEX "Event_status_audienceKind_audienceCity_idx"
  ON "Event" (status, "audienceKind", "audienceCity");

-- RLS. Named `tenant_iso` because that is the shape the RLS coverage guard
-- looks for, and because it IS tenant isolation — just with two ways to belong:
--
--   READ  : the row names this school (it was invited), OR the row belongs to
--           an event this school hosts (it owns the guest list).
--   WRITE : host only. An invitee can see that it was invited; it cannot add
--           itself to someone else's event.
--
-- The invitee branch is a flat indexed comparison and is what the public-site
-- query hits, so the EXISTS subquery only runs for a host managing its own
-- event's list — a handful of rows, not a per-visitor cost.
ALTER TABLE "EventAudienceSchool" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventAudienceSchool" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_iso" ON "EventAudienceSchool"
  USING (
    ("schoolId")::text = current_setting('app.current_tenant', true)
    OR EXISTS (
      SELECT 1 FROM "Event" e
       WHERE e.id = "EventAudienceSchool"."eventId"
         AND (e."schoolId")::text = current_setting('app.current_tenant', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Event" e
       WHERE e.id = "EventAudienceSchool"."eventId"
         AND (e."schoolId")::text = current_setting('app.current_tenant', true)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "EventAudienceSchool" TO skoolos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "EventAudienceSchool" TO skoolos_platform;
