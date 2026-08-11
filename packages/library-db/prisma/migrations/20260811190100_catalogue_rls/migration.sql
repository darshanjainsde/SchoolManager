-- Forced RLS for the catalogue tables, same fail-closed shape as
-- 20260810120000_rls_null_safe_guc: every predicate wraps current_setting in
-- NULLIF(..., '') before the ::uuid cast, because a pooled connection that
-- has already served one SET LOCAL app.current_org sees '' (not NULL) on a
-- later unscoped query, and ''::uuid raises a hard error instead of the
-- comparison quietly evaluating to NULL/false.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Title','Author','Category','Copy'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I '
      'USING ("orgId" = NULLIF(current_setting(''app.current_org'', true), '''')::uuid) '
      'WITH CHECK ("orgId" = NULLIF(current_setting(''app.current_org'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- Join tables carry no orgId; they are reachable only through a parent the
-- policies above already scope, and both FKs cascade from that parent. The
-- EXISTS subquery is itself RLS-filtered, so a Title/Author from another org
-- is invisible and the join row is unreachable. See rls-audit.ts's
-- RLS_ALLOW_LIST for why the coverage audit allow-lists these two tables
-- (their policy expression does not literally reference app.current_org)
-- and rls-audit.spec.ts / isolation.e2e.spec.ts for the cross-org
-- invisibility proof.
ALTER TABLE "TitleAuthor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TitleAuthor" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "TitleAuthor"
  USING (EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId"));

ALTER TABLE "TitleCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TitleCategory" FORCE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON "TitleCategory"
  USING (EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId"));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA library TO library_app, library_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA library TO library_app, library_platform;
