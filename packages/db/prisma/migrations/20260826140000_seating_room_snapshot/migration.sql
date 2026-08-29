-- A saved seating plan must remember the room it was made for.
--
-- `SeatingPlan.seats` freezes where every child sits, but the shape those
-- coordinates are drawn into came from a live join to "Room". Edit the room
-- afterwards — narrow Hall A from nine desks to six — and reopening the plan
-- renders the same frozen seats into the new grid: every seat past S06
-- disappears from the chart while the door list, printed from the same plan,
-- still sends children to them.
--
-- Nullable on purpose. Plans written before this column exists have no
-- snapshot to backfill from that is any more truthful than the live room, so
-- `SeatingService.get` falls back to the join for those and every plan written
-- from here on carries its own floor.

ALTER TABLE "SeatingPlan" ADD COLUMN "roomShape" JSONB;
