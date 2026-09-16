-- The Sessions wizard asks "which class sections belong to this academic year?"
-- six times in a single pass through the year-end flow. `ClassSection` carried
-- only @@index([schoolId]), so the year filter fell through to a sequential
-- scan over every school's sections.
--
-- Measured on a 200-school / 6,000-section database: the review step's roll
-- count discarded 5,970 rows to find 30 (2.2 ms), and the bare
-- "sections in this year" lookup was a Seq Scan. With this index they are
-- 0.6 ms and 0.06 ms. The number that matters is not the millisecond saving —
-- it is that the scan grew with the number of schools on the PLATFORM rather
-- than with the school doing the asking.
--
-- Plain CREATE INDEX, not CONCURRENTLY: prisma migrate runs each file inside a
-- transaction, where CONCURRENTLY is not allowed. ClassSection holds ~30 rows
-- per school, so the brief lock is not worth working around.
CREATE INDEX IF NOT EXISTS "ClassSection_schoolId_academicYearId_idx"
  ON "ClassSection"("schoolId", "academicYearId");
