-- Fail-closed tenancy. current_setting(..., true) returns NULL when the GUC is
-- unset, so an unscoped query compares orgId = NULL, which is never true, and
-- returns zero rows rather than every row.

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
