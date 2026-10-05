-- The two new backup reasons get a migration to themselves, on purpose.
--
-- ALTER TYPE ... ADD VALUE succeeds inside a transaction on modern Postgres, so
-- it LOOKS safe to bundle — but the new value cannot be REFERENCED until that
-- transaction commits, and Prisma wraps each migration in one. This project has
-- that in its ledger as `enum-value-unusable-in-adding-transaction`, so nothing
-- else belongs in this file.
--
--   SNAPSHOT      a scheduled copy of ONE bucket (school / website / setup / day)
--   BEFORE_RESET  the safety copy of exactly what a reset or a sample-pack load
--                 is about to replace
--   PACK          building a sample pack: the same export, written straight to
--                 the pack's own object in the library
ALTER TYPE "SchoolBackupReason" ADD VALUE IF NOT EXISTS 'SNAPSHOT';
ALTER TYPE "SchoolBackupReason" ADD VALUE IF NOT EXISTS 'BEFORE_RESET';
ALTER TYPE "SchoolBackupReason" ADD VALUE IF NOT EXISTS 'PACK';
