-- ── SALARY ───────────────────────────────────────────────────────────────────
-- The module's shape: a DATED rule book (the country pack in @skoolos/types)
-- applied to an EFFECTIVE-DATED employment record, producing an IMMUTABLE pay
-- run that records which versions of both it used.
--
-- Two house rules are followed exactly, because both were paid for:
--   * RLS compares "schoolId" to app_current_tenant(), NEVER to a ::text cast
--     of the column — casting the column makes the predicate unusable as an
--     index condition and turns every tenant read into a scan of every
--     tenant's rows (20260921_000000_sargable_tenant_policies).
--   * Every foreign key gets an index leading on the FK column, because a
--     referential-integrity check runs OUTSIDE RLS and can never be narrowed
--     to one school (20260921_010000_fk_indexes).

-- ── the school's country ─────────────────────────────────────────────────────
ALTER TABLE "School"
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'IN',
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "region" TEXT,
  ADD COLUMN IF NOT EXISTS "taxYearStartMonth" INTEGER NOT NULL DEFAULT 4;

COMMENT ON COLUMN "School"."countryCode" IS
  'ISO 3166-1 alpha-2. Decides which pay rule book applies. Frozen once a pay run is locked.';
COMMENT ON COLUMN "School"."region" IS
  'State or province within the country. Half of India''s pay law lives here: professional tax is a state levy and Rajasthan has none.';

-- ── who may see a salary ─────────────────────────────────────────────────────
-- Default FALSE for everyone, including existing admins: pay is the first thing
-- in the console where "an admin can see everything" is the wrong answer.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canSeeSalary" BOOLEAN NOT NULL DEFAULT false;

-- ── types ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "PayComponentKind" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_COST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PayComponentCalc" AS ENUM ('FIXED', 'PCT_OF_BASIC', 'PCT_OF_GROSS', 'BALANCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PayPersonKind" AS ENUM ('TEACHER', 'STAFF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'LOCKED', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PayTaxRegime" AS ENUM ('NEW', 'OLD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PayDeclarationStatus" AS ENUM ('DRAFT', 'SUBMITTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── PayComponent ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PayComponent" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId"       UUID NOT NULL,
  "key"            TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "kind"           "PayComponentKind" NOT NULL,
  "calc"           "PayComponentCalc" NOT NULL,
  "rateBps"        INTEGER,
  "taxable"        BOOLEAN NOT NULL DEFAULT true,
  "isWages"        BOOLEAN NOT NULL DEFAULT false,
  "retirementBase" BOOLEAN NOT NULL DEFAULT false,
  "healthBase"     BOOLEAN NOT NULL DEFAULT true,
  "gratuityBase"   BOOLEAN NOT NULL DEFAULT false,
  "prorate"        BOOLEAN NOT NULL DEFAULT true,
  "order"          INTEGER NOT NULL DEFAULT 0,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "hint"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayComponent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayComponent_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayComponent_schoolId_key_key" ON "PayComponent"("schoolId", "key");
CREATE INDEX IF NOT EXISTS "PayComponent_schoolId_order_idx" ON "PayComponent"("schoolId", "order");

-- ── EmployeePay ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EmployeePay" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId"            UUID NOT NULL,
  "personKind"          "PayPersonKind" NOT NULL,
  "teacherId"           UUID,
  "staffId"             UUID,
  "effectiveFrom"       DATE NOT NULL,
  "monthlyGrossMinor"   INTEGER NOT NULL,
  "fixedAmounts"        JSONB NOT NULL DEFAULT '{}',
  "taxRegime"           "PayTaxRegime" NOT NULL DEFAULT 'NEW',
  "pfOptIn"             BOOLEAN NOT NULL DEFAULT true,
  "pfOnActual"          BOOLEAN NOT NULL DEFAULT false,
  "esiExempt"           BOOLEAN NOT NULL DEFAULT false,
  "localTaxExempt"      BOOLEAN NOT NULL DEFAULT false,
  "paidThroughVacation" BOOLEAN NOT NULL DEFAULT true,
  "contractMonths"      INTEGER NOT NULL DEFAULT 12,
  "fixedTerm"           BOOLEAN NOT NULL DEFAULT false,
  "joinedOn"            DATE,
  "pan"                 TEXT,
  "uan"                 TEXT,
  "esiNumber"           TEXT,
  "bankAccount"         TEXT,
  "bankIfsc"            TEXT,
  "bankName"            TEXT,
  "note"                TEXT,
  "createdById"         UUID,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeePay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeePay_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmployeePay_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EmployeePay_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Exactly one of the two ids, always. The library's borrower columns follow
  -- the same rule and it is what keeps "whose pay is this?" answerable.
  CONSTRAINT "EmployeePay_one_person" CHECK (("teacherId" IS NULL) <> ("staffId" IS NULL))
);
CREATE INDEX IF NOT EXISTS "EmployeePay_schoolId_teacherId_effectiveFrom_idx" ON "EmployeePay"("schoolId", "teacherId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "EmployeePay_schoolId_staffId_effectiveFrom_idx" ON "EmployeePay"("schoolId", "staffId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "EmployeePay_teacherId_idx" ON "EmployeePay"("teacherId");
CREATE INDEX IF NOT EXISTS "EmployeePay_staffId_idx" ON "EmployeePay"("staffId");

-- ── PayRun ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PayRun" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId"          UUID NOT NULL,
  "periodYear"        INTEGER NOT NULL,
  "periodMonth"       INTEGER NOT NULL,
  "status"            "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
  "packCountry"       TEXT NOT NULL,
  "packVersion"       TEXT NOT NULL,
  "rulesAsAt"         DATE NOT NULL,
  "headcount"         INTEGER NOT NULL DEFAULT 0,
  "grossMinor"        INTEGER NOT NULL DEFAULT 0,
  "deductionMinor"    INTEGER NOT NULL DEFAULT 0,
  "netMinor"          INTEGER NOT NULL DEFAULT 0,
  "employerCostMinor" INTEGER NOT NULL DEFAULT 0,
  "note"              TEXT,
  "calculatedAt"      TIMESTAMP(3),
  "approvedAt"        TIMESTAMP(3),
  "approvedById"      UUID,
  "lockedAt"          TIMESTAMP(3),
  "lockedById"        UUID,
  "paidAt"            TIMESTAMP(3),
  "createdById"       UUID,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PayRun_month" CHECK ("periodMonth" BETWEEN 1 AND 12)
);
CREATE UNIQUE INDEX IF NOT EXISTS "PayRun_schoolId_periodYear_periodMonth_key" ON "PayRun"("schoolId", "periodYear", "periodMonth");
CREATE INDEX IF NOT EXISTS "PayRun_schoolId_periodYear_periodMonth_idx" ON "PayRun"("schoolId", "periodYear", "periodMonth");

-- ── Payslip ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Payslip" (
  "id"                      UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId"                UUID NOT NULL,
  "payRunId"                UUID NOT NULL,
  "personKind"              "PayPersonKind" NOT NULL,
  "teacherId"               UUID,
  "staffId"                 UUID,
  "name"                    TEXT NOT NULL,
  "designation"             TEXT,
  "lines"                   JSONB NOT NULL,
  "daysInMonth"             INTEGER NOT NULL,
  "daysPaid"                INTEGER NOT NULL,
  "grossMinor"              INTEGER NOT NULL,
  "deductionMinor"          INTEGER NOT NULL,
  "netMinor"                INTEGER NOT NULL,
  "employerCostMinor"       INTEGER NOT NULL,
  "retirementEmployeeMinor" INTEGER NOT NULL DEFAULT 0,
  "retirementEmployerMinor" INTEGER NOT NULL DEFAULT 0,
  "pensionMinor"            INTEGER NOT NULL DEFAULT 0,
  "healthEmployeeMinor"     INTEGER NOT NULL DEFAULT 0,
  "healthEmployerMinor"     INTEGER NOT NULL DEFAULT 0,
  "localTaxMinor"           INTEGER NOT NULL DEFAULT 0,
  "incomeTaxMinor"          INTEGER NOT NULL DEFAULT 0,
  "taxRegime"               "PayTaxRegime" NOT NULL,
  "ytdGrossMinor"           INTEGER NOT NULL DEFAULT 0,
  "ytdTaxMinor"             INTEGER NOT NULL DEFAULT 0,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payslip_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Payslip_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Payslip_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Payslip_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Payslip_one_person" CHECK (("teacherId" IS NULL) <> ("staffId" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "Payslip_payRunId_personKind_teacherId_staffId_key" ON "Payslip"("payRunId", "personKind", "teacherId", "staffId");
CREATE INDEX IF NOT EXISTS "Payslip_schoolId_payRunId_idx" ON "Payslip"("schoolId", "payRunId");
CREATE INDEX IF NOT EXISTS "Payslip_schoolId_teacherId_idx" ON "Payslip"("schoolId", "teacherId");
CREATE INDEX IF NOT EXISTS "Payslip_schoolId_staffId_idx" ON "Payslip"("schoolId", "staffId");
CREATE INDEX IF NOT EXISTS "Payslip_payRunId_idx" ON "Payslip"("payRunId");
CREATE INDEX IF NOT EXISTS "Payslip_teacherId_idx" ON "Payslip"("teacherId");
CREATE INDEX IF NOT EXISTS "Payslip_staffId_idx" ON "Payslip"("staffId");

-- ── PayAdjustment ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PayAdjustment" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId"    UUID NOT NULL,
  "personKind"  "PayPersonKind" NOT NULL,
  "teacherId"   UUID,
  "staffId"     UUID,
  "periodYear"  INTEGER NOT NULL,
  "periodMonth" INTEGER NOT NULL,
  "label"       TEXT NOT NULL,
  "kind"        "PayComponentKind" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "taxable"     BOOLEAN NOT NULL DEFAULT true,
  "lopDays"     INTEGER NOT NULL DEFAULT 0,
  "note"        TEXT,
  "payRunId"    UUID,
  "createdById" UUID,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayAdjustment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PayAdjustment_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PayAdjustment_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PayAdjustment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PayAdjustment_one_person" CHECK (("teacherId" IS NULL) <> ("staffId" IS NULL)),
  CONSTRAINT "PayAdjustment_month" CHECK ("periodMonth" BETWEEN 1 AND 12)
);
CREATE INDEX IF NOT EXISTS "PayAdjustment_schoolId_periodYear_periodMonth_idx" ON "PayAdjustment"("schoolId", "periodYear", "periodMonth");
CREATE INDEX IF NOT EXISTS "PayAdjustment_payRunId_idx" ON "PayAdjustment"("payRunId");
CREATE INDEX IF NOT EXISTS "PayAdjustment_teacherId_idx" ON "PayAdjustment"("teacherId");
CREATE INDEX IF NOT EXISTS "PayAdjustment_staffId_idx" ON "PayAdjustment"("staffId");

-- ── TaxDeclaration ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TaxDeclaration" (
  "id"                          UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId"                    UUID NOT NULL,
  "personKind"                  "PayPersonKind" NOT NULL,
  "teacherId"                   UUID,
  "staffId"                     UUID,
  "taxYear"                     INTEGER NOT NULL,
  "regime"                      "PayTaxRegime" NOT NULL DEFAULT 'NEW',
  "rentAnnualMinor"             INTEGER NOT NULL DEFAULT 0,
  "metro"                       BOOLEAN NOT NULL DEFAULT false,
  "landlordPan"                 TEXT,
  "section80cMinor"             INTEGER NOT NULL DEFAULT 0,
  "section80dMinor"             INTEGER NOT NULL DEFAULT 0,
  "homeLoanInterestMinor"       INTEGER NOT NULL DEFAULT 0,
  "otherIncomeMinor"            INTEGER NOT NULL DEFAULT 0,
  "previousEmployerSalaryMinor" INTEGER NOT NULL DEFAULT 0,
  "previousEmployerTdsMinor"    INTEGER NOT NULL DEFAULT 0,
  "status"                      "PayDeclarationStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt"                 TIMESTAMP(3),
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxDeclaration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TaxDeclaration_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaxDeclaration_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaxDeclaration_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TaxDeclaration_one_person" CHECK (("teacherId" IS NULL) <> ("staffId" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "TaxDeclaration_schoolId_personKind_teacherId_staffId_taxYear_key"
  ON "TaxDeclaration"("schoolId", "personKind", "teacherId", "staffId", "taxYear");
CREATE INDEX IF NOT EXISTS "TaxDeclaration_schoolId_taxYear_idx" ON "TaxDeclaration"("schoolId", "taxYear");
CREATE INDEX IF NOT EXISTS "TaxDeclaration_teacherId_idx" ON "TaxDeclaration"("teacherId");
CREATE INDEX IF NOT EXISTS "TaxDeclaration_staffId_idx" ON "TaxDeclaration"("staffId");

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Sargable by construction: the uuid column is compared to a uuid-returning
-- plain-SQL function the planner inlines, so "schoolId" stays an INDEX
-- CONDITION. GRANTs come from ALTER DEFAULT PRIVILEGES set up in
-- 20260703_000100_rls_and_roles, which covers every table created after it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PayComponent','EmployeePay','PayRun','Payslip','PayAdjustment','TaxDeclaration'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_iso'
    ) THEN
      EXECUTE format(
        'CREATE POLICY tenant_iso ON %I USING ("schoolId" = app_current_tenant()) WITH CHECK ("schoolId" = app_current_tenant())',
        t
      );
    END IF;
  END LOOP;
END $$;

-- ── the first person who may see a salary ────────────────────────────────────
-- Somebody has to hold the right before anyone can grant it, or the module is
-- a locked room with the key inside. The school's EARLIEST admin gets it; every
-- other admin is granted it by them, by name, and the grant is audited.
UPDATE "User" u
SET "canSeeSalary" = true
WHERE u."role" = 'SCHOOL_ADMIN'
  AND u."schoolId" IS NOT NULL
  AND u."id" = (
    SELECT u2."id" FROM "User" u2
    WHERE u2."schoolId" = u."schoolId" AND u2."role" = 'SCHOOL_ADMIN' AND u2."isActive"
    ORDER BY u2."createdAt" ASC, u2."id" ASC
    LIMIT 1
  );
