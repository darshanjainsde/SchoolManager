-- Hall of Fame: batches (year is a dimension), groups (course / grades / custom), settings.
-- Carries every existing podium into a COURSE group for its parsed year. See
-- docs/superpowers/specs/2026-09-07-hall-of-fame-batches-design.md.

CREATE TYPE "HallOfFameGroupKind" AS ENUM ('COURSE', 'GRADES', 'CUSTOM');

CREATE TABLE "HallOfFameGroup" (
  "id"         UUID NOT NULL,
  "schoolId"   UUID NOT NULL,
  "kind"       "HallOfFameGroupKind" NOT NULL,
  "label"      TEXT NOT NULL,
  "order"      INTEGER NOT NULL DEFAULT 0,
  "courseId"   UUID,
  "gradeIds"   UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "sectionIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  CONSTRAINT "HallOfFameGroup_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "HallOfFameGroup_schoolId_idx" ON "HallOfFameGroup"("schoolId");
ALTER TABLE "HallOfFameGroup" ADD CONSTRAINT "HallOfFameGroup_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HallOfFameGroup" ADD CONSTRAINT "HallOfFameGroup_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "HallOfFameSettings" (
  "schoolId"    UUID NOT NULL,
  "landingYear" INTEGER,
  "pastBatches" INTEGER NOT NULL DEFAULT 4,
  CONSTRAINT "HallOfFameSettings_pkey" PRIMARY KEY ("schoolId")
);
ALTER TABLE "HallOfFameSettings" ADD CONSTRAINT "HallOfFameSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Entries: new columns first (nullable), then carry the data, then tighten.
ALTER TABLE "HallOfFameEntry"
  ADD COLUMN "groupId"   UUID,
  ADD COLUMN "batchYear" INTEGER,
  ADD COLUMN "studentId" UUID;

-- One COURSE group per course that has a podium today. gen_random_uuid() is
-- built into PostgreSQL 13+ (Supabase included).
INSERT INTO "HallOfFameGroup" ("id", "schoolId", "kind", "label", "order", "courseId")
SELECT gen_random_uuid(), c."schoolId", 'COURSE', c."name", c."order", c."id"
FROM "Course" c
WHERE EXISTS (SELECT 1 FROM "HallOfFameEntry" e WHERE e."courseId" = c."id");

UPDATE "HallOfFameEntry" e
SET "groupId" = g."id"
FROM "HallOfFameGroup" g
WHERE g."courseId" = e."courseId" AND g."kind" = 'COURSE';

-- Batch year: a 4-digit year in the old caption, else the current academic
-- year's start year, else this year. NOTE substring(x from pattern) returns
-- the FIRST parenthesized group, so the whole year is the group and the
-- alternation inside it is non-capturing. A caption that was not a year is kept
-- as part of the achievement so no words are lost.
UPDATE "HallOfFameEntry" e
SET "batchYear" = COALESCE(
      NULLIF(substring(e."year" from '((?:19|20)[0-9]{2})'), '')::INTEGER,
      (SELECT EXTRACT(YEAR FROM ay."startDate")::INTEGER FROM "AcademicYear" ay
         WHERE ay."schoolId" = e."schoolId" AND ay."isCurrent" = TRUE LIMIT 1),
      EXTRACT(YEAR FROM now())::INTEGER
    ),
    "achievement" = CASE
      WHEN e."year" IS NOT NULL AND btrim(e."year") <> '' AND substring(e."year" from '((?:19|20)[0-9]{2})') IS NULL
        THEN NULLIF(concat_ws(' · ', e."achievement", btrim(e."year")), '')
      ELSE e."achievement"
    END;

-- Any orphan (a course row deleted under RLS-less tooling) cannot be carried.
DELETE FROM "HallOfFameEntry" WHERE "groupId" IS NULL;

DROP INDEX IF EXISTS "HallOfFameEntry_courseId_rank_key";
ALTER TABLE "HallOfFameEntry" DROP CONSTRAINT IF EXISTS "HallOfFameEntry_courseId_fkey";
ALTER TABLE "HallOfFameEntry"
  DROP COLUMN "courseId",
  DROP COLUMN "year",
  ALTER COLUMN "groupId" SET NOT NULL,
  ALTER COLUMN "batchYear" SET NOT NULL;
CREATE UNIQUE INDEX "HallOfFameEntry_groupId_batchYear_rank_key" ON "HallOfFameEntry"("groupId", "batchYear", "rank");
ALTER TABLE "HallOfFameEntry" ADD CONSTRAINT "HallOfFameEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "HallOfFameGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HallOfFameEntry" ADD CONSTRAINT "HallOfFameEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: own-tenant read/write, the same guarantee every CMS sibling carries.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['HallOfFameGroup','HallOfFameSettings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
