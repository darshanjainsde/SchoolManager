-- The four new admissions stages get a migration to themselves, on purpose.
--
-- ALTER TYPE ... ADD VALUE succeeds inside a transaction on modern Postgres, so
-- it LOOKS safe to bundle with the columns that use it — but the new value
-- cannot be REFERENCED until that transaction commits, and Prisma wraps each
-- migration in one. Same reasoning as 20260827170000_alumnus_role.
--
-- Nothing else belongs in this file. The first row carrying one of these is
-- written by the application, long after this has committed.
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'VISITED';
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'APPLIED';
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'ENROLLED';
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'LOST';
