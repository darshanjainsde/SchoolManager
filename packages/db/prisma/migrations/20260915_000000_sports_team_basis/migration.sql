-- Sports wing: what a team is in a team sport (SECTIONS 9 A v 9 B, CLASSES 9 v 10,
-- HOUSES), and the rest a child gets between two of their own slots.
ALTER TABLE "SportsEvent" ADD COLUMN "teamBasis" TEXT NOT NULL DEFAULT 'SECTIONS';
ALTER TABLE "SportsTournament" ADD COLUMN "restMin" INTEGER NOT NULL DEFAULT 15;
