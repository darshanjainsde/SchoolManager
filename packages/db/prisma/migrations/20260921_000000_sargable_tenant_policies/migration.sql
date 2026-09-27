-- Make the tenant policy usable as an index condition.
--
-- Every tenant policy compared `"schoolId"::text` to `current_setting(...)`.
-- Casting the COLUMN is what broke it: a btree index on a uuid column cannot
-- answer a predicate on `uuid::text`, so Postgres could never put `schoolId`
-- into the Index Cond. It scanned the whole index — or the whole table — and
-- applied the tenant test as a row filter afterwards.
--
-- The effect is invisible on a small database and becomes the dominant cost as
-- schools are onboarded, because the work is proportional to EVERY school's
-- rows rather than to the caller's. Measured on a 30-school, 7.2M-row copy of
-- Attendance (2026-09-21):
--
--   SELECT ... WHERE "classSectionId" = $1 AND date BETWEEN $2 AND $3
--     before:  46 ms warm / 862 ms cold, 13,896 index pages
--     after:    2 ms warm /   2 ms cold,    558 index pages
--
--   SELECT count(*)                       (RLS is the only predicate)
--     before:  1,399 ms — Parallel Seq Scan, 6,960,000 rows removed by filter
--     after:      31 ms — Bitmap Index Scan
--
--   SELECT ... ORDER BY date DESC LIMIT 50
--     before:  1,271 ms      after: 37 ms
--
-- 129 of the 130 tenant tables already carry an index leading with "schoolId".
-- Those indexes have been present and unusable. Nothing about WHICH rows a
-- tenant may see changes here: same column, same setting, same fail-closed
-- behaviour when the setting is absent or empty. Verified by the isolation
-- suite, which asserts the deny cases rather than only the allow case.

-- ── one expression, one place ───────────────────────────────────────────────
-- A plain SQL function so the planner INLINES it; a plpgsql one would not
-- inline and the predicate would stop being an index condition again.
-- `nullif(..., '')` is not defensive decoration, it is load-bearing: once a
-- transaction that did `set_config(..., TRUE)` commits, the GUC resets to the
-- EMPTY STRING rather than to NULL, so the very next statement on that pooled
-- connection would evaluate `''::uuid` and raise. Verified: without the nullif
-- a plain `SELECT count(*) FROM "School"` outside a transaction errors; with
-- it, it returns 0 rows, which is what the ::text form did.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $fn$ SELECT nullif(current_setting('app.current_tenant', true), '')::uuid $fn$;

COMMENT ON FUNCTION app_current_tenant() IS
  'The tenant this transaction is scoped to, as a uuid. Compare a uuid column '
  'to THIS, never cast the column to text — casting the column makes the '
  'predicate unusable as an index condition and turns every tenant read into a '
  'scan of every tenant''s rows.';

GRANT EXECUTE ON FUNCTION app_current_tenant() TO skoolos_app, skoolos_platform;

-- ── the 124 ordinary tables ─────────────────────────────────────────────────
-- Driven off pg_policies rather than a hand-written list: a table that was
-- added without anyone updating this file still gets rewritten, and a table
-- that does not match the expected shape is left alone rather than guessed at.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
      FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname = 'tenant_iso'
       AND qual = '(("schoolId")::text = current_setting(''app.current_tenant''::text, true))'
  LOOP
    EXECUTE format('DROP POLICY tenant_iso ON %I.%I', r.schemaname, r.tablename);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I.%I USING ("schoolId" = app_current_tenant()) WITH CHECK ("schoolId" = app_current_tenant())',
      r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ── the four that are not the ordinary shape ────────────────────────────────

-- School matches on its own id.
DROP POLICY tenant_iso ON "School";
CREATE POLICY tenant_iso ON "School"
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

-- EventAudienceSchool: the invited school sees the row naming it, the host
-- school sees its own event's whole audience. Only the host may write.
DROP POLICY tenant_iso ON "EventAudienceSchool";
CREATE POLICY tenant_iso ON "EventAudienceSchool"
  USING (
    "schoolId" = app_current_tenant()
    OR EXISTS (SELECT 1 FROM "Event" e WHERE e.id = "EventAudienceSchool"."eventId" AND e."schoolId" = app_current_tenant())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "Event" e WHERE e.id = "EventAudienceSchool"."eventId" AND e."schoolId" = app_current_tenant())
  );

-- EventRegistration: a school reads the registrations it SENT as well as the
-- ones it received, and may only insert against a genuinely network event.
DROP POLICY read_own_outbound_registrations ON "EventRegistration";
CREATE POLICY read_own_outbound_registrations ON "EventRegistration" FOR SELECT
  USING ("fromSchoolId" = app_current_tenant());

DROP POLICY register_for_network_event ON "EventRegistration";
CREATE POLICY register_for_network_event ON "EventRegistration" FOR INSERT
  WITH CHECK (
    "fromSchoolId" = app_current_tenant()
    AND EXISTS (
      SELECT 1 FROM "Event" e
       WHERE e.id = "EventRegistration"."eventId"
         AND e.scope = 'NETWORK'
         AND e.status = 'APPROVED'
         AND e."schoolId" = "EventRegistration"."schoolId"
    )
  );

-- `Event.read_network_events` and `EventTicketType.read_network_ticket_types`
-- name no tenant column at all — they are the deliberate cross-tenant reads —
-- so there is nothing to make sargable and they are left exactly as they were.

-- ── refuse to finish with a policy still casting a column ───────────────────
-- A migration that silently half-applied would leave the slow shape on the
-- tables nobody looked at, which is precisely how this survived in the first
-- place.
DO $$
DECLARE stragglers text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename)
    INTO stragglers
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (coalesce(qual, '') LIKE '%)::text = current_setting%'
       OR coalesce(with_check, '') LIKE '%)::text = current_setting%');
  IF stragglers IS NOT NULL THEN
    RAISE EXCEPTION 'tenant policies still cast a column to text: %', stragglers;
  END IF;
END $$;
