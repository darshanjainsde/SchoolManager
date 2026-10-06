-- Notification spine, Tier 1b: the leave desk, done right.
--
-- EXPAND ONLY. Every new column is nullable, so no table rewrite and no long
-- lock; an older client that sends halfDay without halfDayPart stays valid
-- (NULL). A backup taken before today restores onto this schema.

-- Which half of a half day. Only meaningful with halfDay; the CHECK says so.
ALTER TABLE "LeaveApplication" ADD COLUMN "halfDayPart" TEXT;
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_halfDayPart_check"
  CHECK ("halfDayPart" IS NULL OR ("halfDay" AND "halfDayPart" IN ('AM', 'PM')));

-- A gap knows the leave it was opened for, and whether its substitute has seen it.
ALTER TABLE "Substitution" ADD COLUMN "leaveApplicationId" UUID;
ALTER TABLE "Substitution" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "Substitution" ADD CONSTRAINT "Substitution_leaveApplicationId_fkey"
  FOREIGN KEY ("leaveApplicationId") REFERENCES "LeaveApplication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Substitution_leaveApplicationId_idx" ON "Substitution"("leaveApplicationId");
CREATE INDEX "Substitution_schoolId_substituteTeacherId_date_idx" ON "Substitution"("schoolId", "substituteTeacherId", "date");

-- BEST-EFFORT backfill: a gap opened by an approval belongs to the ONE approved
-- leave of its teacher that spans its date. Where two approved leaves overlap
-- that date nothing is guessed: the row stays NULL and a cancel uses the old
-- teacher-and-date rule for it. If the migration role is subject to RLS on
-- these tables it may touch no rows; that is harmless, nothing after this
-- statement depends on it.
UPDATE "Substitution" s SET "leaveApplicationId" = m.leave_id
FROM (
  SELECT s2.id AS sub_id, MIN(la.id::text)::uuid AS leave_id
  FROM "Substitution" s2
  JOIN "LeaveApplication" la
    ON la."schoolId" = s2."schoolId"
   AND la."teacherId" = s2."originalTeacherId"
   AND la.status = 'APPROVED'
   AND s2.date BETWEEN la."startDate" AND la."endDate"
  WHERE s2.reason = 'leave' AND s2."leaveApplicationId" IS NULL
  GROUP BY s2.id
  HAVING COUNT(*) = 1
) m
WHERE s.id = m.sub_id;
