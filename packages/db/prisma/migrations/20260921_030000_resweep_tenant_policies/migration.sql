-- Re-run the sargable rewrite, so a migration that lands OUT OF ORDER cannot
-- reintroduce the slow policy shape.
--
-- 20260921_000000 rewrote every `"schoolId"::text = current_setting(...)`
-- policy to `"schoolId" = app_current_tenant()`. It is driven off pg_policies,
-- so on any database where it runs LAST it catches everything, including
-- tables it was never told about.
--
-- Prisma applies PENDING migrations in name order, not the order they were
-- authored, and those two facts collide here. The phone-login, WhatsApp and
-- email-delivery migrations are named 20260920_* and are applied on staging
-- but NOT on production. When they are promoted, production will apply them
-- AFTER 20260921_000000 has already been recorded — so the tables they create
-- would arrive with the old casting policies and the rewrite would never run
-- again. Staging would be fast and production would not, on the same schema.
--
-- `rls-coverage.e2e-spec.ts` would fail on that PR, which is the safety net
-- working. This is the belt: a migration named late enough to run after them,
-- doing the same sweep, and a no-op on any database that is already correct.
--
-- Idempotent by construction — it only touches policies still carrying the
-- cast, and there are none on a database that has already been swept.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
      FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname = 'tenant_iso'
       AND qual = '(("schoolId")::text = current_setting(''app.current_tenant''::text, true))'
  LOOP
    RAISE NOTICE 'resweeping tenant_iso on %.%', r.schemaname, r.tablename;
    EXECUTE format('DROP POLICY tenant_iso ON %I.%I', r.schemaname, r.tablename);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I.%I USING ("schoolId" = app_current_tenant()) WITH CHECK ("schoolId" = app_current_tenant())',
      r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Same refusal as the original: finishing with a policy that still casts a
-- column is how this defect survived a year the first time.
DO $$
DECLARE stragglers text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename)
    INTO stragglers
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (coalesce(qual, '') LIKE '%)::text = current_setting%'
       OR coalesce(with_check, '') LIKE '%)::text = current_setting%');
  IF stragglers IS NOT NULL THEN
    RAISE EXCEPTION 'tenant policies still cast a column to text: %', stragglers;
  END IF;
END $$;
