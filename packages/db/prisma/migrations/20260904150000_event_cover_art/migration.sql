-- Which archetype an event's cover art draws.
--
-- Additive and nullable on purpose: every existing row keeps working and simply
-- derives its cover from the title, which is what the app does when this is
-- null. No backfill, no default — a default would be a lie about what the
-- school chose.
ALTER TABLE "Event" ADD COLUMN "coverArt" TEXT;
