-- Close the RLS coverage gap Supabase's security scanner flagged
-- (`rls_disabled_in_public`, project skoolos-mumbai).
--
-- Every table in `public` is reachable through Supabase's Data API, so a table
-- without row-level security is readable and writable by anyone holding the
-- project's anon key. Eight tables had none. They were added by later
-- migrations that created the table but did not join the RLS loop the original
-- rls_and_roles migration established — the gap is invisible in review because
-- each migration looks complete on its own.
--
-- Two shapes of fix, chosen per table by WHICH DATABASE ROLE actually reads it
-- (verified against every call site before writing this):
--
--   * Tenant tables — reached by the app role through `withTenant`, so they get
--     the same `tenant_iso` policy as their neighbours: a row is visible only
--     while `app.current_tenant` matches its schoolId.
--
--   * Platform tables — reached ONLY through `getPlatformPrisma()`, which
--     connects as a BYPASSRLS role. They get RLS plus an explicit deny-all
--     policy: the platform role still passes (it bypasses), the app role and
--     Supabase's anon/authenticated roles get nothing. A deny-all policy rather
--     than no policy at all, so the intent is stated in the schema instead of
--     being inferred from an absence.
--
-- ENABLE without FORCE on the platform tables is deliberate: FORCE would bind
-- the table OWNER too, and the owner is the role that runs migrations and
-- maintenance. Non-owner roles are already denied by ENABLE + deny-all, which
-- is the exposure being closed.

-- ── Tenant tables ────────────────────────────────────────────────────────────
-- LeaveTypeDef and LeaveAllocation are per-school leave policy, written and
-- read by the admin console through withTenant.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LeaveTypeDef','LeaveAllocation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;

-- ── Platform-only tables ─────────────────────────────────────────────────────
-- PasswordResetToken and ImpersonationToken hold single-use credentials;
-- MarketingLead holds names and phone numbers typed by the public; BlogPost and
-- SchoolBlogSelection are the editorial library. Every one of them is read and
-- written exclusively by the BYPASSRLS platform role.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'PasswordResetToken','ImpersonationToken',
    'MarketingLead','MarketingConfig',
    'BlogPost','SchoolBlogSelection'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('CREATE POLICY platform_only ON %I USING (false) WITH CHECK (false);', t);
  END LOOP;
END $$;
