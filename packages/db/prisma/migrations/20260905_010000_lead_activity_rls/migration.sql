-- LeadActivity shipped without row-level security.
--
-- Supabase exposes the whole `public` schema through its Data API, so a table
-- with RLS disabled is readable and writable by anyone holding the project's
-- anon key. That is the exact finding its scanner reported against production
-- once before (`rls_disabled_in_public`), and the reason rls-coverage.spec.ts
-- exists — it is what caught this one, in CI, before the table held anything.
--
-- `platform_only`, not `tenant_iso`: LeadActivity hangs off MarketingLead and
-- has no schoolId. A marketing lead belongs to Sckools, not to a school, so
-- there is no tenant to scope it to. Deny-all is the same treatment
-- MarketingLead, MarketingConfig, BlogPost, SchoolBlogSelection,
-- PasswordResetToken, ImpersonationToken and MetricRollup already get: the
-- tenant client can never see it, and the platform client reaches it by
-- bypassing RLS, which is the only path that should.
ALTER TABLE "LeadActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeadActivity" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'LeadActivity' AND policyname = 'platform_only'
  ) THEN
    CREATE POLICY platform_only ON "LeadActivity" USING (false) WITH CHECK (false);
  END IF;
END $$;
