-- A break left on the venue after each slot: the umpire changing ends, the rake
-- over the pit, the next pair walking on. Distinct from restMin, which is the
-- rest one CHILD gets between two of their own slots.
ALTER TABLE "SportsTournament" ADD COLUMN "gapMin" INTEGER NOT NULL DEFAULT 0;
