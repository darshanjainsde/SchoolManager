-- A class visit is unique per BRANCH, not just per org.
--
-- The original index omitted branchId, so two branches that each have a "6-B"
-- shared one visit row: openVisit would hand branch A's visit to branch B and
-- both class rosters would merge into one. A multi-branch school is exactly the
-- case this service claims to support, so this is a correctness bug, not a
-- theoretical one.
DROP INDEX IF EXISTS "ClassVisit_one_per_class_day";
CREATE UNIQUE INDEX "ClassVisit_one_per_class_day"
  ON "ClassVisit"("orgId", "branchId", "classRef", "date");
