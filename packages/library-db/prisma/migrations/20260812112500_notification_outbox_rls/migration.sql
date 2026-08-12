-- Forced RLS for NotificationOutbox, same fail-closed shape as
-- 20260811190300_circulation_rls: the predicate wraps current_setting in
-- NULLIF(..., '') before the ::uuid cast so a connection that has already
-- served a scoped request and then runs an unscoped query fails closed
-- rather than raising a cast error on '' (trap 1, LIBRARY-TRAPS.md).
-- NotificationOutbox carries its own orgId column, so this is the direct
-- (not join-table-indirect) shape — no allow-listing needed.

ALTER TABLE "NotificationOutbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationOutbox" FORCE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON "NotificationOutbox"
  USING ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK ("orgId" = NULLIF(current_setting('app.current_org', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA library TO library_app, library_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA library TO library_app, library_platform;
