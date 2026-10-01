-- School backups: every school as one portable, password-locked file.
-- Design: docs/superpowers/specs/2026-10-01-school-backups-design.md
--
-- 1. School.statusChangedAt — when the status last changed. Deleting a school
--    needs a backup taken AFTER it was suspended (a suspended school cannot be
--    written to, so that backup is complete); this is how that is checked.
ALTER TABLE "School" ADD COLUMN "statusChangedAt" TIMESTAMP(3);

-- 2. The backup register and the restore register.
--    PLATFORM data, deliberately NOT tenant data:
--      - no "schoolId" column (it is "sourceSchoolId"), so the backup engine,
--        which takes every table carrying schoolId, never backs up backups and
--        a school purge never deletes them;
--      - no foreign key to School, so a school's backups outlive the school —
--        which is the whole point of the final backup taken before a delete.
CREATE TYPE "SchoolBackupStatus" AS ENUM ('RUNNING', 'READY', 'FAILED', 'EXPIRED');
CREATE TYPE "SchoolBackupReason" AS ENUM ('MANUAL', 'BEFORE_DELETE', 'BEFORE_REPLACE', 'WEEKLY', 'UPLOADED');
CREATE TYPE "SchoolRestoreStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

CREATE TABLE "SchoolBackup" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "sourceSchoolId" UUID NOT NULL,
  "schoolSlug"     TEXT NOT NULL,
  "schoolName"     TEXT NOT NULL,
  "reason"         "SchoolBackupReason" NOT NULL,
  "status"         "SchoolBackupStatus" NOT NULL DEFAULT 'RUNNING',
  "storageKey"     TEXT NOT NULL,
  "sizeBytes"      BIGINT,
  "rowCount"       INTEGER,
  "fileCount"      INTEGER,
  "manifest"       JSONB,
  "state"          JSONB,
  "error"          TEXT,
  "deleteSchoolAfter" BOOLEAN NOT NULL DEFAULT false,
  "createdBy"      TEXT,
  "lockedUntil"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"     TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3),
  CONSTRAINT "SchoolBackup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SchoolBackup_storageKey_key" ON "SchoolBackup"("storageKey");
CREATE INDEX "SchoolBackup_sourceSchoolId_createdAt_idx" ON "SchoolBackup"("sourceSchoolId", "createdAt");
CREATE INDEX "SchoolBackup_status_idx" ON "SchoolBackup"("status");
-- One running backup per school at a time: two would race on the same rows
-- and the second adds nothing.
CREATE UNIQUE INDEX "SchoolBackup_one_running_per_school" ON "SchoolBackup"("sourceSchoolId") WHERE "status" = 'RUNNING';

CREATE TABLE "SchoolRestore" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "backupId"       UUID,
  "sourceSchoolId" UUID NOT NULL,
  "targetSlug"     TEXT NOT NULL,
  "mode"           TEXT NOT NULL,
  "finalStatus"    TEXT NOT NULL,
  "status"         "SchoolRestoreStatus" NOT NULL DEFAULT 'RUNNING',
  "state"          JSONB,
  "report"         JSONB,
  "error"          TEXT,
  "createdBy"      TEXT,
  "lockedUntil"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"     TIMESTAMP(3),
  CONSTRAINT "SchoolRestore_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolRestore_backupId_fkey" FOREIGN KEY ("backupId") REFERENCES "SchoolBackup"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SchoolRestore_backupId_idx" ON "SchoolRestore"("backupId");
CREATE INDEX "SchoolRestore_sourceSchoolId_idx" ON "SchoolRestore"("sourceSchoolId");
-- One restore into a school at a time.
CREATE UNIQUE INDEX "SchoolRestore_one_running_per_school" ON "SchoolRestore"("sourceSchoolId") WHERE "status" = 'RUNNING';

-- Owner-console data: the platform role is the only grantee, as for MetricRollup.
GRANT SELECT, INSERT, UPDATE, DELETE ON "SchoolBackup" TO skoolos_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON "SchoolRestore" TO skoolos_platform;

-- 3. The two append-only registers could never be deleted — not even with the
--    school. Both trigger functions raised on EVERY delete, for every role
--    (row triggers fire for the table owner too; the fees migration's comment
--    saying otherwise was wrong), so a school that had ever taken a fee or
--    issued a certificate could not be removed at all.
--
--    The exception is as narrow as it can be. A delete passes only when
--      (a) the transaction has named THIS school as the one being purged
--          (`set_config('sckools.purge_school', <id>, true)` — local to the
--          transaction, gone at COMMIT), and
--      (b) that school is SUSPENDED — no tenant request can reach it.
--    Updates are untouched: an entry still cannot be edited, ever.
CREATE OR REPLACE FUNCTION "fee_ledger_append_only"() RETURNS TRIGGER AS $fn$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('sckools.purge_school', true) = OLD."schoolId"::text
     AND EXISTS (SELECT 1 FROM "School" s WHERE s."id" = OLD."schoolId" AND s."status" = 'SUSPENDED') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'FeeLedgerEntry is append-only: % is not permitted. Post an opposing entry instead.', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "press_issue_guard"() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('sckools.purge_school', true) = OLD."schoolId"::text
       AND EXISTS (SELECT 1 FROM "School" s WHERE s."id" = OLD."schoolId" AND s."status" = 'SUSPENDED') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'PressIssue is append-only — register entries are never deleted';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."schoolId" IS DISTINCT FROM OLD."schoolId"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."serial" IS DISTINCT FROM OLD."serial"
     OR NEW."studentId" IS DISTINCT FROM OLD."studentId"
     OR NEW."windowId" IS DISTINCT FROM OLD."windowId"
     OR NEW."payload"::text IS DISTINCT FROM OLD."payload"::text
     OR NEW."issuedById" IS DISTINCT FROM OLD."issuedById"
     OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" THEN
    RAISE EXCEPTION 'PressIssue is immutable — correct a wrong document by voiding it and issuing afresh';
  END IF;
  IF OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'This register entry is already voided';
  END IF;
  IF NEW."voidedAt" IS NULL THEN
    RAISE EXCEPTION 'The only permitted update to a register entry is voiding it';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
