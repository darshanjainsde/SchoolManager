-- Sckools TV: one revocable display token per school. Null = the /tv page
-- answers 404 for this school. Additive and nullable — safe on live rows.
ALTER TABLE "School" ADD COLUMN "tvKey" TEXT;
