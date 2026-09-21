-- Index the foreign keys Postgres has to check when a parent row is deleted.
--
-- A referential-integrity check runs `SELECT 1 FROM child WHERE "fkCol" = $1`,
-- and it does NOT go through row-level security — so it can never be narrowed
-- to one school. With no index whose FIRST column is the FK, Postgres reads the
-- whole child table (or scans a composite index that leads with "schoolId"
-- from end to end). The cost is proportional to EVERY school's rows, on an
-- operation one school triggered.
--
-- Measured on a copy of "Result" carrying the real index set (2026-09-21):
--
--   rows        no leading index   with it     ratio
--     360,000       4.96 ms        0.17 ms      29x
--   3,600,000     106.64 ms        1.08 ms      99x
--
-- Ten times the rows cost twenty-one times the work, which is the shape to
-- watch: it grows with the SHARED table, not with the tenant who asked.
--
-- Deleting one student fires fourteen of these checks. `DELETE FROM "Student"`
-- against otherwise-empty child tables already spends essentially all of its
-- 53 ms inside them; at 3.6M-row children that is well over a second of
-- connection hold for an action the office thinks is instant. Deleting a
-- school fans out over every one of them.
--
-- The other side of the trade, measured on the same table:
--   bulk insert of 200,000 rows   2.31-2.42 s -> 2.81-3.29 s   (~+4 us/row)
--   table + index storage         111 MB      -> 127 MB        (+14%)
--
-- A few microseconds per insert against 99x on the check is the right trade,
-- and it is cheapest to make now: each of these builds in milliseconds at
-- today's volumes and in minutes at next year's.
--
-- NOT `CONCURRENTLY`: Prisma wraps a migration in a transaction and
-- `CREATE INDEX CONCURRENTLY` cannot run inside one. Each takes an ACCESS
-- EXCLUSIVE lock for the length of its build, so this belongs in the
-- migrate-before-deploy step like every other migration here — not during
-- morning attendance.
--
-- Deliberately NOT here: "FeePlanItem" (categoryId, gradeId, termId). A fee
-- plan has a handful of items per school; that check stays sub-millisecond at
-- any school count this product will see, and an index there is storage with
-- no reader.

CREATE INDEX IF NOT EXISTS "AlumniAccessToken_alumniId_idx" ON "AlumniAccessToken"("alumniId");
CREATE INDEX IF NOT EXISTS "Announcement_classSectionId_idx" ON "Announcement"("classSectionId");
CREATE INDEX IF NOT EXISTS "Assignment_classSectionId_idx" ON "Assignment"("classSectionId");
CREATE INDEX IF NOT EXISTS "Assignment_subjectId_idx" ON "Assignment"("subjectId");
CREATE INDEX IF NOT EXISTS "AssignmentSeen_studentId_idx" ON "AssignmentSeen"("studentId");
CREATE INDEX IF NOT EXISTS "AttendanceNotice_studentId_idx" ON "AttendanceNotice"("studentId");
CREATE INDEX IF NOT EXISTS "ClassNote_classSectionId_idx" ON "ClassNote"("classSectionId");
CREATE INDEX IF NOT EXISTS "ClassNote_subjectId_idx" ON "ClassNote"("subjectId");
CREATE INDEX IF NOT EXISTS "ClassTodo_classSectionId_idx" ON "ClassTodo"("classSectionId");
CREATE INDEX IF NOT EXISTS "ClassTodo_subjectId_idx" ON "ClassTodo"("subjectId");
CREATE INDEX IF NOT EXISTS "DiaryAck_studentId_idx" ON "DiaryAck"("studentId");
CREATE INDEX IF NOT EXISTS "DiaryEntry_classSectionId_idx" ON "DiaryEntry"("classSectionId");
CREATE INDEX IF NOT EXISTS "DiaryEntry_subjectId_idx" ON "DiaryEntry"("subjectId");
CREATE INDEX IF NOT EXISTS "DiaryRecipient_studentId_idx" ON "DiaryRecipient"("studentId");
CREATE INDEX IF NOT EXISTS "EnquiryNote_enquiryId_idx" ON "EnquiryNote"("enquiryId");
CREATE INDEX IF NOT EXISTS "FeeAllocation_invoiceId_idx" ON "FeeAllocation"("invoiceId");
CREATE INDEX IF NOT EXISTS "FeeAllocation_invoiceLineId_idx" ON "FeeAllocation"("invoiceLineId");
CREATE INDEX IF NOT EXISTS "FeeAllocation_paymentId_idx" ON "FeeAllocation"("paymentId");
CREATE INDEX IF NOT EXISTS "FeeConcession_categoryId_idx" ON "FeeConcession"("categoryId");
CREATE INDEX IF NOT EXISTS "FeeConcession_studentId_idx" ON "FeeConcession"("studentId");
CREATE INDEX IF NOT EXISTS "FeeConcession_termId_idx" ON "FeeConcession"("termId");
CREATE INDEX IF NOT EXISTS "FeeInvoice_planId_idx" ON "FeeInvoice"("planId");
CREATE INDEX IF NOT EXISTS "FeeInvoice_termId_idx" ON "FeeInvoice"("termId");
CREATE INDEX IF NOT EXISTS "FeeInvoiceLine_categoryId_idx" ON "FeeInvoiceLine"("categoryId");
CREATE INDEX IF NOT EXISTS "FeeInvoiceLine_invoiceId_idx" ON "FeeInvoiceLine"("invoiceId");
CREATE INDEX IF NOT EXISTS "FeeLedgerEntry_studentId_idx" ON "FeeLedgerEntry"("studentId");
CREATE INDEX IF NOT EXISTS "FeePayment_invoiceId_idx" ON "FeePayment"("invoiceId");
CREATE INDEX IF NOT EXISTS "FeePayment_studentId_idx" ON "FeePayment"("studentId");
CREATE INDEX IF NOT EXISTS "HallOfFameEntry_studentId_idx" ON "HallOfFameEntry"("studentId");
CREATE INDEX IF NOT EXISTS "HousePoint_houseId_idx" ON "HousePoint"("houseId");
CREATE INDEX IF NOT EXISTS "LibraryBookCopy_titleId_idx" ON "LibraryBookCopy"("titleId");
CREATE INDEX IF NOT EXISTS "LibraryFine_issueId_idx" ON "LibraryFine"("issueId");
CREATE INDEX IF NOT EXISTS "LibraryIssue_studentId_idx" ON "LibraryIssue"("studentId");
CREATE INDEX IF NOT EXISTS "LibraryIssue_teacherId_idx" ON "LibraryIssue"("teacherId");
CREATE INDEX IF NOT EXISTS "MessageThread_classSectionId_idx" ON "MessageThread"("classSectionId");
CREATE INDEX IF NOT EXISTS "MessageThread_subjectId_idx" ON "MessageThread"("subjectId");
CREATE INDEX IF NOT EXISTS "MessageThread_teacherId_idx" ON "MessageThread"("teacherId");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_classSectionId_idx" ON "NotificationOutbox"("classSectionId");
CREATE INDEX IF NOT EXISTS "PressIssue_studentId_idx" ON "PressIssue"("studentId");
CREATE INDEX IF NOT EXISTS "PressIssue_windowId_idx" ON "PressIssue"("windowId");
CREATE INDEX IF NOT EXISTS "PrintOrderEvent_orderId_idx" ON "PrintOrderEvent"("orderId");
CREATE INDEX IF NOT EXISTS "RegisterChangeRequest_classSectionId_idx" ON "RegisterChangeRequest"("classSectionId");
CREATE INDEX IF NOT EXISTS "ReportRemark_studentId_idx" ON "ReportRemark"("studentId");
CREATE INDEX IF NOT EXISTS "Result_studentId_idx" ON "Result"("studentId");
CREATE INDEX IF NOT EXISTS "SessionDecision_studentId_idx" ON "SessionDecision"("studentId");
CREATE INDEX IF NOT EXISTS "SportsEntry_studentId_idx" ON "SportsEntry"("studentId");
CREATE INDEX IF NOT EXISTS "Student_classSectionId_idx" ON "Student"("classSectionId");
CREATE INDEX IF NOT EXISTS "Student_houseId_idx" ON "Student"("houseId");
CREATE INDEX IF NOT EXISTS "TimetableSlot_academicYearId_idx" ON "TimetableSlot"("academicYearId");
CREATE INDEX IF NOT EXISTS "TimetableSlot_classSectionId_idx" ON "TimetableSlot"("classSectionId");
CREATE INDEX IF NOT EXISTS "TimetableSlot_periodId_idx" ON "TimetableSlot"("periodId");
CREATE INDEX IF NOT EXISTS "TimetableSlot_subjectId_idx" ON "TimetableSlot"("subjectId");
CREATE INDEX IF NOT EXISTS "TimetableSlot_teacherId_idx" ON "TimetableSlot"("teacherId");

-- The meet tables, added after a second pass: a single athletics meet in this
-- product is sized for 1,800 children, so events, heats, matches and venues
-- are activity-scale, and `DELETE /sports/tournaments/:id` is a button in the
-- desk. Deleting a tournament checks every one of these.
CREATE INDEX IF NOT EXISTS "SportsEvent_tournamentId_idx" ON "SportsEvent"("tournamentId");
CREATE INDEX IF NOT EXISTS "SportsVenue_tournamentId_idx" ON "SportsVenue"("tournamentId");
CREATE INDEX IF NOT EXISTS "SportsHeat_eventId_idx" ON "SportsHeat"("eventId");
CREATE INDEX IF NOT EXISTS "SportsMatch_eventId_idx" ON "SportsMatch"("eventId");

-- One fee row per student per plan: roster-scale, and a plan is deletable.
CREATE INDEX IF NOT EXISTS "FeeAssignment_planId_idx" ON "FeeAssignment"("planId");

-- "LibraryIssue"."copyId" is the same shape that cost the library service
-- 17 s -> 823 s on its own e2e suite (packages/library-db/src/fk-indexes.spec.ts):
-- the only index on the column is PARTIAL — `LibraryIssue_open_copy_key`, which
-- covers `returnedOn IS NULL` — and Postgres cannot use a partial index for a
-- referential-integrity check, which has to see every row. Deleting a copy
-- therefore scans the whole issue history, of every school.
CREATE INDEX IF NOT EXISTS "LibraryIssue_copyId_idx" ON "LibraryIssue"("copyId");
