-- "OtpChallenge" shipped to staging with no row-level security at all.
--
-- It carries a "schoolId", so it looked like an ordinary tenant table and was
-- simply missed; with RLS off, the tenant role could read every phone number
-- and every code hash on the platform. Nothing failed, because every code path
-- that touches it already uses the platform connection — which is also why
-- this was invisible.
--
-- The right shape is `platform_only`, the same as "PasswordResetToken" and
-- "ImpersonationToken": pre-authentication credential material that the tenant
-- connection must never touch AT ALL. `OtpService` only ever uses
-- getPlatformPrisma(), and it has to — the caller has not logged in yet, and
-- the per-phone limits (three an hour, ten a day) deliberately count across
-- schools, so a school-scoped view of this table would be the wrong answer as
-- well as an unnecessary one.
--
-- Not FORCEd, for the same reason the other platform_only tables are not: the
-- policy is already `false`, and the platform client owns the tables.
--
-- Guarded on the table existing so this is safe to apply to a database that
-- has not yet taken the phone-login migrations.
--
-- Found by apps/api/test/rls-coverage.e2e-spec.ts, which is the point of it:
-- a new table with no policy behaves perfectly for whoever created the row.
DO $$
BEGIN
  IF to_regclass('public."OtpChallenge"') IS NULL THEN
    RAISE NOTICE 'OtpChallenge not present; nothing to secure';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE "OtpChallenge" ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'OtpChallenge' AND policyname = 'platform_only'
  ) THEN
    EXECUTE 'CREATE POLICY platform_only ON "OtpChallenge" USING (false) WITH CHECK (false)';
  END IF;
END $$;
