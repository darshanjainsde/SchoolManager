-- Phase 7 — per-tenant usage view.
-- A single SELECT joining count(*) across tenant tables, grouped by schoolId.
-- BYPASSRLS is needed (the platform role has it), so this view is exposed
-- only to platform-portal endpoints, not tenant ones.

CREATE OR REPLACE VIEW tenant_usage AS
SELECT
  s.id              AS "schoolId",
  s.slug            AS "slug",
  s.name            AS "name",
  (SELECT count(*) FROM "User" u WHERE u."schoolId" = s.id)            AS "userCount",
  (SELECT count(*) FROM "User" u WHERE u."schoolId" = s.id AND u.role = 'STUDENT')  AS "studentCount",
  (SELECT count(*) FROM "User" u WHERE u."schoolId" = s.id AND u.role = 'TEACHER')  AS "teacherCount",
  (SELECT count(*) FROM "Class" c WHERE c."schoolId" = s.id)            AS "classCount",
  (SELECT count(*) FROM "Enrollment" e WHERE e."schoolId" = s.id)       AS "enrollmentCount",
  (SELECT count(*) FROM "Attendance" a WHERE a."schoolId" = s.id)       AS "attendanceCount",
  (SELECT count(*) FROM "Assignment" a WHERE a."schoolId" = s.id)       AS "assignmentCount",
  (SELECT count(*) FROM "Invoice" i WHERE i."schoolId" = s.id)          AS "invoiceCount",
  (SELECT coalesce(sum(p.amount), 0) FROM "Payment" p WHERE p."schoolId" = s.id) AS "paymentTotal",
  (SELECT count(*) FROM "AuditLog" l WHERE l."schoolId" = s.id)         AS "auditCount"
FROM "School" s;

GRANT SELECT ON tenant_usage TO skoolos_platform;
