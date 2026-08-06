-- Soft clear ("dismiss") for in-app notifications: a cleared row disappears
-- from the caller's list and counts but is never destroyed.
ALTER TABLE "Notification" ADD COLUMN "clearedAt" TIMESTAMP(3);
