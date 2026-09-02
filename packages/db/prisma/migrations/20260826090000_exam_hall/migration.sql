-- Exam Hall — the two tables the seating screen needs, and nothing else.
--
-- `Room` is deliberately a general school asset rather than an exam-only one:
-- the office records its rooms once, and anything later that needs a venue
-- (timetable, events, parent-teacher desks) reads the same rows.
--
-- `SeatingPlan` stores a whole generated chart as JSONB instead of a row per
-- student. A plan is written once and afterwards read WHOLE — the office
-- prints it; nothing queries inside it. A `Seat` table would be the largest in
-- this schema (one row per student per paper) to serve reads that always want
-- every row anyway. Promoting it is a later migration, on the day the parent
-- portal needs "where does my child sit".

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 6,
    "cols" INTEGER NOT NULL DEFAULT 6,
    "seatsPerDesk" INTEGER NOT NULL DEFAULT 1,
    -- "row:col", 0-based, for grid positions that hold no desk.
    "removedDesks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatingPlan" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "classSectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rules" JSONB NOT NULL,
    "seed" INTEGER NOT NULL,
    "seats" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeatingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: a school's room list, and "is this name taken" on save.
CREATE UNIQUE INDEX "Room_schoolId_name_key" ON "Room"("schoolId", "name");
CREATE INDEX "Room_schoolId_idx" ON "Room"("schoolId");

-- CreateIndex: the two reads the plans list actually makes — newest first for
-- the whole school, and every plan made for one room.
CREATE INDEX "SeatingPlan_schoolId_createdAt_idx" ON "SeatingPlan"("schoolId", "createdAt");
CREATE INDEX "SeatingPlan_schoolId_roomId_idx" ON "SeatingPlan"("schoolId", "roomId");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeatingPlan" ADD CONSTRAINT "SeatingPlan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeatingPlan" ADD CONSTRAINT "SeatingPlan_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: own-tenant read/write via the direct "schoolId" — the same shape as the
-- other 70+ tenant tables, set up the same way as 20260819100000_website_studio.
-- GRANTs come from the ALTER DEFAULT PRIVILEGES in 20260703_000100_rls_and_roles.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Room', 'SeatingPlan'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
