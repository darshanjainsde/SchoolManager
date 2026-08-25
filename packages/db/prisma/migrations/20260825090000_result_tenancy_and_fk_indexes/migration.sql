-- Schema audit remediation — tenancy consistency + the foreign keys that had
-- no index at all.
--
-- Two independent changes ship together because both are pure schema work and
-- both want the same empty-database window before onboarding:
--
--   PART 1  `Result` and `AssignmentSeen` carry `schoolId` directly, so their
--           RLS policy becomes the same direct comparison every other tenant
--           table uses instead of an EXISTS subquery against their parent.
--   PART 2  Twelve indexes for foreign keys that were in NO index at all.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1 — direct tenancy for Result and AssignmentSeen
-- ─────────────────────────────────────────────────────────────────────────────
--
-- These were the only two tenant tables deriving tenancy through a parent:
--
--   CREATE POLICY tenant_iso ON "Result"
--     USING (EXISTS (SELECT 1 FROM "Exam" e WHERE e.id = "Result"."examId"
--                    AND e."schoolId"::text = current_setting(...)))
--
-- That is correct but second-class, for two reasons:
--
--   * One shape for 70 tables and a different shape for two is how an
--     exemption survives a review nobody re-reads. The RLS coverage spec
--     proves a policy EXISTS; it does not prove the policies agree.
--   * It cannot be indexed usefully. `Result` had exactly one index —
--     @@unique([examId, studentId]) — so "show me this child's results", the
--     most common read a parent triggers, had nothing to use, because
--     studentId never leads. There was no schoolId column to lead with either.
--
-- WHY THE BACKFILL TURNS FORCE OFF FIRST. Both tables are FORCE ROW LEVEL
-- SECURITY. As 20260824090000_rls_coverage_gap already records, FORCE binds
-- the table OWNER — and the owner is the role that runs migrations. With FORCE
-- on and `app.current_tenant` unset, the policy evaluates false for every row,
-- so the UPDATE below would report success having touched NOTHING, and the
-- following SET NOT NULL would then fail on a table that looks fine. Dropping
-- FORCE for the length of the backfill is what makes it actually run. It is
-- restored before the transaction ends, and DDL holds ACCESS EXCLUSIVE
-- throughout, so no other session ever observes the table unforced.
--
-- No orphan handling is needed: `examId`/`assignmentId` are NOT NULL and their
-- foreign keys cascade, so every row necessarily has a parent to read the
-- schoolId from. SET NOT NULL is therefore the assertion that the backfill was
-- complete — if any row failed to match, this migration fails loudly here
-- rather than leaving a half-converted table behind.

-- ── Result ───────────────────────────────────────────────────────────────────
ALTER TABLE "Result" ADD COLUMN "schoolId" UUID;

ALTER TABLE "Result" NO FORCE ROW LEVEL SECURITY;

UPDATE "Result" r
   SET "schoolId" = e."schoolId"
  FROM "Exam" e
 WHERE e."id" = r."examId";

ALTER TABLE "Result" ALTER COLUMN "schoolId" SET NOT NULL;

ALTER TABLE "Result"
  ADD CONSTRAINT "Result_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Result_schoolId_studentId_idx" ON "Result"("schoolId", "studentId");

DROP POLICY IF EXISTS tenant_iso ON "Result";
ALTER TABLE "Result" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "Result"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

-- ── AssignmentSeen ───────────────────────────────────────────────────────────
ALTER TABLE "AssignmentSeen" ADD COLUMN "schoolId" UUID;

ALTER TABLE "AssignmentSeen" NO FORCE ROW LEVEL SECURITY;

UPDATE "AssignmentSeen" s
   SET "schoolId" = a."schoolId"
  FROM "Assignment" a
 WHERE a."id" = s."assignmentId";

ALTER TABLE "AssignmentSeen" ALTER COLUMN "schoolId" SET NOT NULL;

ALTER TABLE "AssignmentSeen"
  ADD CONSTRAINT "AssignmentSeen_schoolId_fkey"
  FOREIGN KEY ("schoolId") REFERENCES "School"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AssignmentSeen_schoolId_studentId_idx"
  ON "AssignmentSeen"("schoolId", "studentId");

DROP POLICY IF EXISTS tenant_iso ON "AssignmentSeen";
ALTER TABLE "AssignmentSeen" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "AssignmentSeen"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2 — foreign keys that were in no index at all
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Postgres does not index a foreign key for you. The audit that prompted this
-- counted 42 FKs that do not LEAD an index; re-measuring against the schema,
-- 30 of those 42 already sit second in a `(schoolId, col)` composite — which
-- is exactly the shape the audit recommended adding, so adding it again would
-- only cost write throughput. `LibraryIssue` and `DiaryRecipient`, both named
-- in the audit as gaps, are already in that shape.
--
-- The real gap is the columns below: they appear in NO index, so a lookup by
-- them scans, and so does the child-side check when their parent row is
-- deleted or restricted.
--
-- The composites lead with `schoolId`, matching every other index here: these
-- columns are always queried inside a tenant, and RLS adds the schoolId
-- predicate to every app query regardless. That does leave a parent-side
-- DELETE (`WHERE subjectId = ...`, no tenant predicate) scanning; that is
-- accepted deliberately — deleting a subject or a class section is a rare
-- administrative act, and paying write amplification on every insert to speed
-- it up is the wrong trade.
CREATE INDEX "FeaturedStaff_schoolId_teacherId_idx"
  ON "FeaturedStaff"("schoolId", "teacherId");
CREATE INDEX "CourseFee_schoolId_courseId_idx"
  ON "CourseFee"("schoolId", "courseId");
CREATE INDEX "TimetableSlot_schoolId_subjectId_idx"
  ON "TimetableSlot"("schoolId", "subjectId");
CREATE INDEX "TimetableSlot_schoolId_academicYearId_idx"
  ON "TimetableSlot"("schoolId", "academicYearId");
CREATE INDEX "LeaveApplication_schoolId_typeDefId_idx"
  ON "LeaveApplication"("schoolId", "typeDefId");
CREATE INDEX "NotificationOutbox_schoolId_classSectionId_idx"
  ON "NotificationOutbox"("schoolId", "classSectionId");
CREATE INDEX "Assignment_schoolId_subjectId_idx"
  ON "Assignment"("schoolId", "subjectId");
CREATE INDEX "MessageThread_schoolId_classSectionId_idx"
  ON "MessageThread"("schoolId", "classSectionId");
CREATE INDEX "EventRegistration_schoolId_ticketTypeId_idx"
  ON "EventRegistration"("schoolId", "ticketTypeId");
CREATE INDEX "DiaryEntry_schoolId_subjectId_idx"
  ON "DiaryEntry"("schoolId", "subjectId");
CREATE INDEX "LibraryFine_schoolId_issueId_idx"
  ON "LibraryFine"("schoolId", "issueId");

-- The outbox drain's own query, which no existing index served.
--
-- `NotificationOutboxService.drain()` selects
--   WHERE "sentAt" IS NULL AND attempts < 5 ORDER BY "createdAt" ASC LIMIT 200
-- with NO schoolId predicate — it is a cron across every school. The existing
-- @@index([schoolId, sentAt]) cannot serve that: schoolId leads and is not in
-- the query. So the drain has been sequentially scanning the whole outbox
-- every ten minutes, and would get slower for exactly as long as the table
-- grows. Leading with `sentAt` lets it seek straight to the unsent group and
-- read it already ordered by `createdAt`.
CREATE INDEX "NotificationOutbox_sentAt_createdAt_idx"
  ON "NotificationOutbox"("sentAt", "createdAt");

-- No GRANTs are needed anywhere above: table-level privileges already held by
-- skoolos_app cover new columns and indexes.
