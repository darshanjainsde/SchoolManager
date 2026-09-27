-- ═══════════════════════════════════════════════════════════════════════════
-- PAY GRADES
--
-- A school does not think in individual salaries: it thinks "all TGTs get
-- thirty-five". The money belongs to the JOB. This puts it there, so setting
-- up a payroll is six decisions about grades plus two per person, instead of
-- thirteen per person.
--
-- `PayGrade.overrides` is componentKey -> { rateBps?, fixedMinor? } and is
-- normally EMPTY: the shipped components already split 50/20/30 and already
-- satisfy the Code on Wages wage-share rule, so a grade only carries a split
-- when it genuinely differs (a driver on a higher basic, say).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "PayGrade" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId"     UUID NOT NULL,
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "bandMinMinor" INTEGER NOT NULL DEFAULT 0,
  "bandMaxMinor" INTEGER NOT NULL DEFAULT 0,
  "overrides"    JSONB NOT NULL DEFAULT '{}',
  "order"        INTEGER NOT NULL DEFAULT 0,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "note"         TEXT,
  "createdById"  UUID,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayGrade_pkey" PRIMARY KEY ("id")
);

-- A band that reads backwards is a typo, not a policy.
ALTER TABLE "PayGrade"
  ADD CONSTRAINT "PayGrade_band_ordered" CHECK ("bandMaxMinor" = 0 OR "bandMaxMinor" >= "bandMinMinor");

CREATE UNIQUE INDEX "PayGrade_schoolId_name_key" ON "PayGrade"("schoolId", "name");
CREATE INDEX "PayGrade_schoolId_order_idx" ON "PayGrade"("schoolId", "order");

ALTER TABLE "PayGrade"
  ADD CONSTRAINT "PayGrade_schoolId_fkey" FOREIGN KEY ("schoolId")
  REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── a person points at a grade ───────────────────────────────────────────────
-- Nullable on purpose: a structure typed straight onto one person predates
-- grades and stays legal. SET NULL on delete, because removing a grade must
-- never silently change what anyone is paid — the pay row keeps its figures.
ALTER TABLE "EmployeePay" ADD COLUMN "payGradeId" UUID;

-- Referential-integrity checks run OUTSIDE row-level security, so every
-- foreign key needs its own leading index or the check scans the whole table
-- across every tenant (see the 2026-09-21 tenancy audit).
CREATE INDEX "EmployeePay_payGradeId_idx" ON "EmployeePay"("payGradeId");

ALTER TABLE "EmployeePay"
  ADD CONSTRAINT "EmployeePay_payGradeId_fkey" FOREIGN KEY ("payGradeId")
  REFERENCES "PayGrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── tenant isolation ─────────────────────────────────────────────────────────
-- Same shape as every other tenant table. The predicate compares the COLUMN to
-- app_current_tenant() with no cast on either side: casting "schoolId"::text
-- makes the column unusable as an index condition and turns every tenant read
-- into a scan of all tenants.
ALTER TABLE "PayGrade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayGrade" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "PayGrade"
  USING ("schoolId" = app_current_tenant())
  WITH CHECK ("schoolId" = app_current_tenant());
