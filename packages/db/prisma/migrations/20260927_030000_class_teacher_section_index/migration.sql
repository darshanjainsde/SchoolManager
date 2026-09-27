-- ClassTeacherAssignment.classSectionId had only the (schoolId, classSectionId, fromAt)
-- composite, whose first column is schoolId, so the FK-indexes gate counted it
-- as unindexed: a ClassSection delete would scan the table. Additive, no lock beyond
-- a plain CREATE INDEX on a small table.
CREATE INDEX "ClassTeacherAssignment_classSectionId_idx" ON "ClassTeacherAssignment"("classSectionId");
