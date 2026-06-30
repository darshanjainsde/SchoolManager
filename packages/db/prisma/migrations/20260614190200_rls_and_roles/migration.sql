-- Phase 1: Row-Level Security + dedicated roles.
--
-- Two non-superuser roles drive runtime queries:
--   * skoolos_app      → enforces RLS (tenant queries SET LOCAL app.current_tenant)
--   * skoolos_platform → BYPASSRLS (used for platform-owner queries crossing tenants)
-- Migrations themselves run as the superuser (`skoolos`).

-- ─── Roles ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skoolos_app') THEN
    CREATE ROLE skoolos_app LOGIN PASSWORD 'skoolos_app_pw';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skoolos_platform') THEN
    CREATE ROLE skoolos_platform LOGIN PASSWORD 'skoolos_platform_pw' BYPASSRLS;
  END IF;
END $$;

-- Grants — both roles need full CRUD on app tables and use of sequences.
GRANT USAGE ON SCHEMA public TO skoolos_app, skoolos_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skoolos_app, skoolos_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO skoolos_app, skoolos_platform;

-- Future tables created by later migrations should inherit these grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skoolos_app, skoolos_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO skoolos_app, skoolos_platform;

-- ─── RLS policies ────────────────────────────────────────────────────────────
-- Helper: every policy is identical → "this row belongs to the current tenant".
-- We use current_setting('app.current_tenant', true) which returns NULL if unset
-- (the `true` second arg suppresses errors), giving a default-deny semantic.

-- Schools: a school sees only itself (matched on id, not schoolId).
ALTER TABLE "School" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "School" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_school ON "School"
  USING (id::text = current_setting('app.current_tenant', true));

-- CustomDomain
ALTER TABLE "CustomDomain" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomDomain" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_customdomain ON "CustomDomain"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

-- User
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_user ON "User"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

-- Profile tables
ALTER TABLE "StudentProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StudentProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_student ON "StudentProfile"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "TeacherProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeacherProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_teacher ON "TeacherProfile"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "ParentProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParentProfile" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_parent ON "ParentProfile"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

ALTER TABLE "ParentStudent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ParentStudent" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_parentstudent ON "ParentStudent"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

-- Refresh tokens (tenant-scoped)
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_refreshtoken ON "RefreshToken"
  USING ("schoolId"::text = current_setting('app.current_tenant', true));

-- AuditLog: tenant-scoped rows are gated; platform-scoped rows (schoolId IS NULL)
-- are excluded for tenant connections (only platform conn can see them).
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso_auditlog ON "AuditLog"
  USING (
    "schoolId" IS NOT NULL
    AND "schoolId"::text = current_setting('app.current_tenant', true)
  );

-- PlatformUser / PlatformRefreshToken: NOT RLS-protected — they are only ever
-- queried via the platform connection (BYPASSRLS) and not via the tenant role.
-- We still revoke direct access from skoolos_app as defense-in-depth.
REVOKE SELECT, INSERT, UPDATE, DELETE ON "PlatformUser" FROM skoolos_app;
REVOKE SELECT, INSERT, UPDATE, DELETE ON "PlatformRefreshToken" FROM skoolos_app;
