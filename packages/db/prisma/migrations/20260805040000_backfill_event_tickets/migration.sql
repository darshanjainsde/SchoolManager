-- Every event needs a ticket type, including the ones that predate the rule.
--
-- EventTicketType has been auto-created for every NEW event since Phase 5, but
-- events created before that have none — and `registrationOpen` requires one.
-- The effect was that the public join door built in Phase 6 was shut on every
-- pre-existing event: no Join button, no seat count, nothing to register
-- against. A school with four published events saw four cards nobody could
-- respond to.
--
-- Free, uncapped, and named the same as the auto-created one, so a backfilled
-- event is indistinguishable from one created today.
INSERT INTO "EventTicketType" ("id", "eventId", "schoolId", "name", "priceMinor", "currency", "capacity", "createdAt")
SELECT gen_random_uuid(), e."id", e."schoolId", 'Attendance', 0, 'INR', NULL, now()
FROM "Event" e
WHERE NOT EXISTS (SELECT 1 FROM "EventTicketType" t WHERE t."eventId" = e."id");
