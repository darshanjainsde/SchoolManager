-- Indexes for the tenant-scoped relation counts that replace Prisma's
-- `include: { _count: ... }`.
--
-- Prisma compiles a relation `_count` into a LEFT JOIN over a subquery whose
-- WHERE clause is `1=1`: it aggregates the WHOLE table and lets the join throw
-- away other schools' rows. RLS then filters the result, so the answer was
-- always right — it just cost the whole platform's data to compute. The
-- aggregates are now written explicitly with a schoolId predicate, and these
-- are the indexes that predicate seeks on.
--
-- Measured on the 200-school bench, 2026-08-29 (1M messages):
--   unread messages per thread   2,432 ms  ->  1.77 ms
CREATE INDEX IF NOT EXISTS "Message_schoolId_senderRole_readAt_idx"
  ON "Message" ("schoolId", "senderRole", "readAt");

CREATE INDEX IF NOT EXISTS "AssignmentSeen_schoolId_assignmentId_idx"
  ON "AssignmentSeen" ("schoolId", "assignmentId");
