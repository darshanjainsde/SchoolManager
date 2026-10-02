-- Backup buckets: a school is four buckets, each saved and restored on its own.
-- The two new `SchoolBackupReason` values are added by the migration before
-- this one, because an enum value cannot be referenced in the transaction that
-- adds it.
--
-- 1. Which buckets an archive holds, and the fingerprint that lets an
--    unchanged bucket be recognised instead of kept again.
ALTER TABLE "SchoolBackup"
  ADD COLUMN IF NOT EXISTS "scope"         TEXT,
  ADD COLUMN IF NOT EXISTS "version"       INTEGER,
  ADD COLUMN IF NOT EXISTS "contentHash"   TEXT,
  ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3);

-- Existing rows are whole-school backups, which is what NULL already means.
CREATE INDEX IF NOT EXISTS "SchoolBackup_sourceSchoolId_scope_createdAt_idx"
  ON "SchoolBackup"("sourceSchoolId", "scope", "createdAt");

-- One running job per school PER SCOPE, instead of one per school. Four
-- buckets can be saved at once, while two copies of the same bucket — or two
-- whole-school backups — still cannot overlap and write one object twice.
DROP INDEX IF EXISTS "SchoolBackup_one_running_per_school";
CREATE UNIQUE INDEX "SchoolBackup_one_running_per_school_scope"
  ON "SchoolBackup"("sourceSchoolId", (COALESCE("scope", '')))
  WHERE "status" = 'RUNNING';

-- A PACK build writes straight to the pack's object in the library, so the job
-- row has to know which pack it is building.
ALTER TABLE "SchoolBackup" ADD COLUMN IF NOT EXISTS "packId" UUID;

ALTER TABLE "SchoolRestore"
  ADD COLUMN IF NOT EXISTS "scope"  TEXT,
  ADD COLUMN IF NOT EXISTS "packId" UUID;

-- 2. The sample-pack library. PLATFORM level on purpose: a pack belongs to the
--    platform, not to the school it was cut from, so deleting that school can
--    never take the pack with it.
CREATE TABLE IF NOT EXISTS "SamplePack" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "name"             TEXT         NOT NULL,
  "notes"            TEXT,
  "scope"            TEXT         NOT NULL,
  "storageKey"       TEXT         NOT NULL,
  "sizeBytes"        BIGINT,
  "rowCount"         INTEGER,
  "fileCount"        INTEGER,
  "version"          INTEGER      NOT NULL DEFAULT 1,
  -- BUILDING while its export job runs, then READY or FAILED.
  "status"           TEXT         NOT NULL DEFAULT 'BUILDING',
  "error"            TEXT,
  "manifest"         JSONB,
  "sourceSchoolId"   UUID,
  "sourceSchoolName" TEXT,
  "loadCount"        INTEGER      NOT NULL DEFAULT 0,
  "lastLoadedAt"     TIMESTAMP(3),
  "createdBy"        TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SamplePack_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SamplePack_name_key" ON "SamplePack"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "SamplePack_storageKey_key" ON "SamplePack"("storageKey");
CREATE INDEX IF NOT EXISTS "SamplePack_createdAt_idx" ON "SamplePack"("createdAt");

-- The platform role is the only grantee, as for SchoolBackup and MetricRollup.
GRANT SELECT, INSERT, UPDATE, DELETE ON "SamplePack" TO skoolos_platform;

-- ...and the tenant role must never see a library that names every school a
-- pack was cut from, so the same platform_only shape: RLS on, a policy that is
-- always false, deliberately NOT forced so the platform client — the only
-- reader — still reaches it. A table added without this is exactly the gap
-- Supabase reported as rls_disabled_in_public once before.
ALTER TABLE "SamplePack" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS platform_only ON "SamplePack";
CREATE POLICY platform_only ON "SamplePack" USING (false) WITH CHECK (false);
