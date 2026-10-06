--
-- The admissions officer's two new words get a migration to themselves, on
-- purpose — the same reasoning as 20260904170000_enquiry_stages.
--
-- ALTER TYPE ... ADD VALUE succeeds inside a transaction, so it LOOKS safe to
-- bundle with the columns that follow — but a new value cannot be REFERENCED
-- until that transaction commits, and Prisma wraps each migration in one.
--
-- Nothing else belongs in this file. The first row carrying either value is
-- written by the application, long after this has committed.
--
-- INTERESTED goes BEFORE VISITED so ORDER BY status reads in pipeline order.
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ADMISSIONS';
ALTER TYPE "EnquiryStatus" ADD VALUE IF NOT EXISTS 'INTERESTED' BEFORE 'VISITED';
