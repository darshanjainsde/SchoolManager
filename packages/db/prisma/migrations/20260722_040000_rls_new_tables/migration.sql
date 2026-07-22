-- RLS for the 7 tables added since 20260703_000100_rls_and_roles:
-- Attendance, Exam, Result, Staff, StaffAttendance, Substitution, LeaveApplication.
--
-- Grants: not needed here. ALTER DEFAULT PRIVILEGES ... GRANT ... ON TABLES
-- set up in 20260703_000100_rls_and_roles already covers every table created
-- afterwards (all 7 of these were created in later migrations), so
-- skoolos_app/skoolos_platform already have SELECT/INSERT/UPDATE/DELETE here.

-- Tables with a direct "schoolId" column: standard tenant policy.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Attendance','Exam','Staff','StaffAttendance','Substitution','LeaveApplication'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;

-- Result: no "schoolId" column of its own — tenancy is derived via
-- Result.examId -> Exam.schoolId, so the policy checks that relationship.
ALTER TABLE "Result" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Result" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_iso ON "Result";
CREATE POLICY tenant_iso ON "Result"
  USING (EXISTS (SELECT 1 FROM "Exam" e WHERE e.id = "Result"."examId" AND e."schoolId"::text = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM "Exam" e WHERE e.id = "Result"."examId" AND e."schoolId"::text = current_setting('app.current_tenant', true)));
