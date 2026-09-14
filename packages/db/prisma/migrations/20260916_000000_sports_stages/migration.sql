-- Sports wing: qualifying stages (class heats → best of each class → final),
-- an event pinned to a day of the meet, and the class a heat belongs to.
ALTER TABLE "SportsEvent" ADD COLUMN "stageShape" TEXT NOT NULL DEFAULT 'STRAIGHT';
ALTER TABLE "SportsEvent" ADD COLUMN "advancePerClass" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "SportsEvent" ADD COLUMN "finalists" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "SportsEvent" ADD COLUMN "dayIdx" INTEGER;
ALTER TABLE "SportsHeat" ADD COLUMN "groupLabel" TEXT;
