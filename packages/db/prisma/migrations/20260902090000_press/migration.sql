-- The Press: printed documents with a register — report cards, certificates.
-- Design: "The Clear Runway" build plan (2 Sept 2026).
--
-- Decisions worth reading before changing anything here:
--
--   1. "PressIssue"."type" is TEXT, not an enum (the FeePayment.provider /
--      NotificationOutbox.kind decision). Adding a document type — ID cards,
--      HPC, consent forms — is a template file and a validator entry in
--      @skoolos/types, never a migration.
--
--   2. "payload" is an immutable snapshot of exactly what was printed. A
--      reprint renders the snapshot, never a fresh compile. The register row
--      IS the feature: a TC register is a statutory record.
--
--   3. Serials come from press_next_number(), an atomic upsert copied from
--      fee_next_number() — a read-then-write on the counter under READ
--      COMMITTED is a duplicate-serial race, so application code never touches
--      "PressCounter" directly. The @@unique on (schoolId, type, serial) is
--      the belt to that suspender.
--
-- Every table carries "schoolId" DIRECTLY and gets the tenant_iso policy in
-- this same migration — the shape 20260825090000_result_tenancy_and_fk_indexes
-- had to retrofit onto Result.

-- ── Structure ───────────────────────────────────────────────────────────────

CREATE TABLE "PressIssue" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "serial" TEXT NOT NULL,
  "studentId" UUID NOT NULL,
  "windowId" UUID,
  "payload" JSONB NOT NULL,
  "issuedById" UUID NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PressIssue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PressIssue_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PressIssue_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PressIssue_schoolId_type_serial_key" ON "PressIssue"("schoolId", "type", "serial");
-- NULL windowIds (certificates) never collide; report cards get database-level
-- once-per-window-per-student idempotency.
CREATE UNIQUE INDEX "PressIssue_schoolId_type_windowId_studentId_key" ON "PressIssue"("schoolId", "type", "windowId", "studentId");
CREATE INDEX "PressIssue_schoolId_studentId_idx" ON "PressIssue"("schoolId", "studentId");
CREATE INDEX "PressIssue_schoolId_type_issuedAt_idx" ON "PressIssue"("schoolId", "type", "issuedAt");

CREATE TABLE "PressCounter" (
  "schoolId" UUID NOT NULL,
  "series" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PressCounter_pkey" PRIMARY KEY ("schoolId", "series"),
  CONSTRAINT "PressCounter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ReportWindow" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "academicYearId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportWindow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReportWindow_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportWindow_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReportWindow_schoolId_academicYearId_name_key" ON "ReportWindow"("schoolId", "academicYearId", "name");
CREATE INDEX "ReportWindow_schoolId_idx" ON "ReportWindow"("schoolId");

CREATE TABLE "ReportRemark" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "windowId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "authorId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportRemark_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReportRemark_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportRemark_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "ReportWindow"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportRemark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "PressIssue" ADD CONSTRAINT "PressIssue_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "ReportWindow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ReportRemark_windowId_studentId_key" ON "ReportRemark"("windowId", "studentId");
CREATE INDEX "ReportRemark_schoolId_studentId_idx" ON "ReportRemark"("schoolId", "studentId");

-- ── Serial allocation ───────────────────────────────────────────────────────
-- Same shape as fee_next_number: the upsert takes a row lock, so two clerks
-- issuing at the same moment get consecutive values, never the same one.

CREATE OR REPLACE FUNCTION "press_next_number"(p_school UUID, p_series TEXT)
RETURNS INTEGER AS $fn$
DECLARE v INTEGER;
BEGIN
  INSERT INTO "PressCounter" ("schoolId", "series", "value")
    VALUES (p_school, p_series, 1)
    ON CONFLICT ("schoolId", "series")
    DO UPDATE SET "value" = "PressCounter"."value" + 1
    RETURNING "value" INTO v;
  RETURN v;
END;
$fn$ LANGUAGE plpgsql;

-- ── Row-level security ──────────────────────────────────────────────────────
-- Same tenant_iso policy every other tenant table carries, comparing schoolId
-- DIRECTLY. PressCounter is included: it is per-school and reached through
-- withTenant like everything else.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PressIssue','PressCounter','ReportWindow','ReportRemark'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
