-- Forced RLS for the circulation tables, same fail-closed shape as
-- 20260811190100_catalogue_rls: every predicate wraps current_setting in
-- NULLIF(..., '') before the ::uuid cast (see that migration's comment for
-- the full reasoning). CirculationPolicy, Loan, Hold and Fine all carry
-- their own orgId column, so this is the direct (not join-table-indirect)
-- shape — no allow-listing needed.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CirculationPolicy','Loan','Hold','Fine'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I '
      'USING ("orgId" = NULLIF(current_setting(''app.current_org'', true), '''')::uuid) '
      'WITH CHECK ("orgId" = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA library TO library_app, library_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA library TO library_app, library_platform;
