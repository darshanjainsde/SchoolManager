-- Repair for databases that ran the first cut of 20260907_000000 before its
-- substring() fix: substring(x from '(19|20)[0-9]{2}') returns the first
-- parenthesized group, so every carried-over podium got batchYear = 19 or 20.
-- The caption column is gone, so the best available year is the school's
-- current academic year (else this calendar year). Databases that ran the
-- corrected migration have no such rows and this changes nothing.
UPDATE "HallOfFameEntry" e
SET "batchYear" = COALESCE(
  (SELECT EXTRACT(YEAR FROM ay."startDate")::INTEGER FROM "AcademicYear" ay
     WHERE ay."schoolId" = e."schoolId" AND ay."isCurrent" = TRUE LIMIT 1),
  EXTRACT(YEAR FROM now())::INTEGER
)
WHERE e."batchYear" < 1900;
