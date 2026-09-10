-- Sports wing P1. See docs/superpowers/specs/2026-09-10-sports-wing-design.md §8.
-- Additive only: one enum value, two columns, eleven tables. Safe to apply to
-- production before the code that reads it deploys.

ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'SPORTS';
ALTER TABLE "Staff" ADD COLUMN "sportsPerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TYPE "SportsTournamentStatus" AS ENUM ('DRAFT', 'LIVE', 'DONE');

CREATE TABLE "SportsSettings" (
  "schoolId" UUID NOT NULL,
  "grouping" TEXT NOT NULL DEFAULT 'BANDS',
  "bands" JSONB NOT NULL DEFAULT '[{"id":"sub","label":"Sub-junior","stds":[1,2,3,4,5,6]},{"id":"jun","label":"Junior","stds":[7,8]},{"id":"sen","label":"Senior","stds":[9,10,11,12]}]',
  "pointsPlacing" INTEGER[] NOT NULL DEFAULT ARRAY[10,7,5,3,2,1]::INTEGER[],
  "pointsMatchWin" INTEGER NOT NULL DEFAULT 5,
  "pointsClassWin" INTEGER NOT NULL DEFAULT 3,
  "publishNeedsAdmin" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SportsSettings_pkey" PRIMARY KEY ("schoolId"),
  CONSTRAINT "SportsSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "House" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "name" TEXT NOT NULL, "color" TEXT NOT NULL DEFAULT '#4F46E5', "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "House_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "House_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "House_schoolId_name_key" ON "House"("schoolId", "name");
CREATE INDEX "House_schoolId_idx" ON "House"("schoolId");

ALTER TABLE "Student" ADD COLUMN "houseId" UUID;
ALTER TABLE "Student" ADD CONSTRAINT "Student_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "HousePoint" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "houseId" UUID NOT NULL, "points" INTEGER NOT NULL, "reason" TEXT NOT NULL, "eventId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HousePoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HousePoint_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "HousePoint_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "HousePoint_schoolId_houseId_idx" ON "HousePoint"("schoolId", "houseId");

CREATE TABLE "SportsTournament" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "name" TEXT NOT NULL, "startsOn" DATE NOT NULL, "endsOn" DATE NOT NULL, "grouping" TEXT NOT NULL,
  "dayStartMin" INTEGER NOT NULL DEFAULT 540, "dayEndMin" INTEGER NOT NULL DEFAULT 960, "status" "SportsTournamentStatus" NOT NULL DEFAULT 'DRAFT', "published" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1, "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SportsTournament_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SportsTournament_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SportsTournament_schoolId_status_idx" ON "SportsTournament"("schoolId", "status");

CREATE TABLE "SportsVenue" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "tournamentId" UUID NOT NULL, "name" TEXT NOT NULL, "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SportsVenue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SportsVenue_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SportsVenue_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "SportsTournament"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SportsVenue_schoolId_tournamentId_idx" ON "SportsVenue"("schoolId", "tournamentId");

CREATE TABLE "SportsEvent" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "tournamentId" UUID NOT NULL, "sportKey" TEXT NOT NULL, "sportName" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "groupKey" TEXT NOT NULL, "category" TEXT NOT NULL, "entry" TEXT NOT NULL DEFAULT 'ALL', "structure" TEXT NOT NULL, "slotMin" INTEGER NOT NULL,
  "lanes" INTEGER NOT NULL DEFAULT 6, "venueIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[], "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SportsEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SportsEvent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SportsEvent_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "SportsTournament"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SportsEvent_schoolId_tournamentId_idx" ON "SportsEvent"("schoolId", "tournamentId");

CREATE TABLE "SportsEntry" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "eventId" UUID NOT NULL, "studentId" UUID NOT NULL, "std" INTEGER NOT NULL, "section" TEXT NOT NULL,
  CONSTRAINT "SportsEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SportsEntry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SportsEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SportsEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SportsEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SportsEntry_eventId_studentId_key" ON "SportsEntry"("eventId", "studentId");
CREATE INDEX "SportsEntry_schoolId_eventId_idx" ON "SportsEntry"("schoolId", "eventId");

CREATE TABLE "SportsMatch" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "eventId" UUID NOT NULL, "stage" TEXT NOT NULL, "groupLabel" TEXT NOT NULL, "roundIdx" INTEGER NOT NULL,
  "roundName" TEXT NOT NULL, "pos" INTEGER NOT NULL, "aSide" TEXT, "bSide" TEXT, "scoreA" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "scoreB" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[], "winner" TEXT, "bye" BOOLEAN NOT NULL DEFAULT false, "walkover" BOOLEAN NOT NULL DEFAULT false,
  "venueId" UUID, "atMin" INTEGER, "version" INTEGER NOT NULL DEFAULT 1, "savedById" UUID, "savedAt" TIMESTAMP(3),
  CONSTRAINT "SportsMatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SportsMatch_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SportsMatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SportsEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SportsMatch_schoolId_eventId_idx" ON "SportsMatch"("schoolId", "eventId");

CREATE TABLE "SportsHeat" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "eventId" UUID NOT NULL, "kind" TEXT NOT NULL, "idx" INTEGER NOT NULL, "venueId" UUID, "atMin" INTEGER,
  "done" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "SportsHeat_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SportsHeat_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SportsHeat_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SportsEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SportsHeat_schoolId_eventId_idx" ON "SportsHeat"("schoolId", "eventId");

CREATE TABLE "SportsMark" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "heatId" UUID NOT NULL, "studentId" UUID NOT NULL, "lane" INTEGER NOT NULL, "mark" DOUBLE PRECISION, "rank" INTEGER,
  CONSTRAINT "SportsMark_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SportsMark_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SportsMark_heatId_fkey" FOREIGN KEY ("heatId") REFERENCES "SportsHeat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SportsMark_heatId_studentId_key" ON "SportsMark"("heatId", "studentId");
CREATE INDEX "SportsMark_schoolId_studentId_idx" ON "SportsMark"("schoolId", "studentId");

CREATE TABLE "SportsRecord" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "sportKey" TEXT NOT NULL, "groupKey" TEXT NOT NULL, "category" TEXT NOT NULL, "value" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL, "holderName" TEXT NOT NULL, "holderStudentId" UUID, "setOn" DATE, "sinceYear" INTEGER NOT NULL, "untilYear" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'STANDING', "source" TEXT NOT NULL DEFAULT 'MEET', "note" TEXT, "verifiedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SportsRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SportsRecord_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SportsRecord_schoolId_sportKey_groupKey_category_idx" ON "SportsRecord"("schoolId", "sportKey", "groupKey", "category");

CREATE TABLE "SportsRecordAttempt" (
  "id" UUID NOT NULL, "schoolId" UUID NOT NULL, "sportKey" TEXT NOT NULL, "sportName" TEXT NOT NULL, "groupKey" TEXT NOT NULL, "category" TEXT NOT NULL,
  "studentId" UUID NOT NULL, "value" DOUBLE PRECISION NOT NULL, "unit" TEXT NOT NULL, "source" TEXT NOT NULL, "witnessed" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "enteredById" UUID NOT NULL, "decidedById" UUID, "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SportsRecordAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SportsRecordAttempt_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SportsRecordAttempt_schoolId_status_idx" ON "SportsRecordAttempt"("schoolId", "status");

-- Tenant isolation, the house pattern (loop form as in 20260824090000_rls_coverage_gap).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SportsSettings','House','HousePoint','SportsTournament','SportsVenue','SportsEvent','SportsEntry','SportsMatch','SportsHeat','SportsMark','SportsRecord','SportsRecordAttempt'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
