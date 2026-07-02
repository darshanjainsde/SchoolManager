-- Roles ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skoolos_app') THEN
    CREATE ROLE skoolos_app LOGIN PASSWORD 'skoolos_app_pw';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'skoolos_platform') THEN
    CREATE ROLE skoolos_platform LOGIN PASSWORD 'skoolos_platform_pw' BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO skoolos_app, skoolos_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO skoolos_app, skoolos_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO skoolos_app, skoolos_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO skoolos_app, skoolos_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO skoolos_app, skoolos_platform;

-- Helper: enable + force RLS and add the standard tenant policy on a column.
-- We inline per-table for clarity/auditability.

-- School: matched on id (a school sees only itself).
ALTER TABLE "School" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "School" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "School"
  USING (id::text = current_setting('app.current_tenant', true))
  WITH CHECK (id::text = current_setting('app.current_tenant', true));

-- Every other tenant table: matched on "schoolId".
-- (schoolId-nullable tables User/RefreshToken/AuditLog: platform rows have NULL
--  schoolId and are only ever read via the BYPASSRLS platform role.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Domain','FeatureOverride','User','RefreshToken','AuditLog',
    'SchoolProfile','HomepageContent','StatItem','SocialLink','MenuItem',
    'MediaAsset','FeaturedStaff','AcademicYear','Grade','ClassSection',
    'Subject','Teacher','TeacherSubject','Student','Period','TimetableSlot',
    'Enquiry'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;

-- Event: own-tenant read/write PLUS read of approved network events.
ALTER TABLE "Event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "Event"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
CREATE POLICY read_network_events ON "Event" FOR SELECT
  USING (scope = 'NETWORK' AND status = 'APPROVED');
