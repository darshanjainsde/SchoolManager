-- Fix: the previous migration's fail-closed comment ("current_setting(...,
-- true) returns NULL when the GUC is unset") is only true for a session that
-- has *never* touched app.current_org. Once SET LOCAL app.current_org has run
-- on a connection (which withOrg() does inside a transaction), Postgres
-- creates a placeholder for that custom GUC whose *reset* value is the empty
-- string, not "unset" — so after the transaction commits, later unscoped
-- queries on that same connection see current_setting(..., true) = '' rather
-- than NULL. ''::uuid raises a hard Postgres error (fail-closed in effect,
-- but an error instead of the intended zero rows) rather than the comparison
-- evaluating to NULL/false. Because Prisma pools and reuses connections, any
-- pooled connection that has ever served a tenant-scoped request will exhibit
-- this on every later unscoped query.
--
-- NULLIF collapses '' back to NULL before the cast, restoring "zero rows,
-- not an error" as the actual behaviour of an unscoped query, matching the
-- design intent recorded in the 20260809120000_rls_identity migration.

ALTER POLICY org_isolation ON "LibraryOrg"
  USING ("id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER POLICY org_isolation ON "LibraryDomain"
  USING ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER POLICY org_isolation ON "OrgTheme"
  USING ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER POLICY org_isolation ON "PlanOverride"
  USING ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER POLICY org_isolation ON "Branch"
  USING ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER POLICY org_isolation ON "LibUser"
  USING ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER POLICY org_isolation ON "Member"
  USING ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER POLICY org_isolation ON "AuditLog"
  USING ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER POLICY org_isolation ON "IdempotencyKey"
  USING ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid);
