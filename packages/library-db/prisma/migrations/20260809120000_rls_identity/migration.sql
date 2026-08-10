-- Fail-closed tenancy. current_setting(..., true) returns NULL when the GUC is
-- unset, so an unscoped query compares orgId = NULL, which is never true, and
-- returns zero rows rather than every row.
--
-- UPDATE (superseded by 20260810120000_rls_null_safe_guc — see that
-- migration for the full explanation): the NULL-on-unset behaviour above only
-- holds for a session that has never touched app.current_org. Once `SET
-- LOCAL app.current_org` has run once on a pooled connection, Postgres
-- creates a placeholder for that custom GUC whose *reset* value is the empty
-- string '', not "unset" — so a later unscoped query on that same reused
-- connection sees current_setting(..., true) = '' rather than NULL, and
-- ''::uuid raises a hard Postgres error instead of the comparison evaluating
-- to NULL/false. The 20260810120000 migration wraps every comparison here in
-- NULLIF(current_setting('app.current_org', true), '') so both the
-- never-set case (NULL) and the reset-after-SET-LOCAL case ('') collapse to
-- NULL before the ::uuid cast — that NULLIF'd expression, not the bare
-- current_setting(...)::uuid shown below, is what actually runs today. Do
-- not use the SQL in this file as a reference for current policy text; read
-- pg_policies or the later migration instead.

-- LibraryOrg is keyed by id, not orgId.
ALTER TABLE "LibraryOrg" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LibraryOrg" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "LibraryOrg"
  USING ("id" = current_setting('app.current_org', true)::uuid)
  WITH CHECK ("id" = current_setting('app.current_org', true)::uuid);

-- Every other tenant table is keyed by orgId.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'LibraryDomain','OrgTheme','PlanOverride','Branch','LibUser','Member',
    'AuditLog','IdempotencyKey'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I '
      'USING ("orgId" = current_setting(''app.current_org'', true)::uuid) '
      'WITH CHECK ("orgId" = current_setting(''app.current_org'', true)::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA library TO library_app, library_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA library TO library_app, library_platform;
