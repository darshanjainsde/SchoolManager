-- The fees module: what a school is owed, what arrived, and the ledger that
-- reconciles them. Design: the "Sckools Fees Blueprint" pitch (29 Aug 2026).
--
-- Two structural decisions are worth reading before changing anything here:
--
--   1. FeePayment is RAIL-AGNOSTIC. `provider` is a text column, not an enum,
--      so adding PhonePe or Razorpay is an adapter file and a config row —
--      never a migration. Manual bank transfer and a gateway webhook write the
--      same row, which is why nothing above this table changes when a gateway
--      arrives.
--
--   2. FeeLedgerEntry is append-only and is the ONLY source of a balance.
--      No table stores a running total. A correction is an opposing row.
--
-- Every table carries "schoolId" DIRECTLY and gets the tenant_iso policy in
-- this same migration — the shape 20260825090000_result_tenancy_and_fk_indexes
-- had to retrofit onto Result. Not repeating that.

CREATE TYPE "FeeFrequency" AS ENUM ('PER_TERM', 'ANNUAL', 'ONE_TIME');
CREATE TYPE "FeePaymentStatus" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED', 'REVERSED');
CREATE TYPE "FeePaymentMethod" AS ENUM ('UPI', 'NEFT_IMPS', 'CHEQUE', 'CASH', 'CARD', 'NETBANKING', 'OTHER');
CREATE TYPE "FeeLedgerKind" AS ENUM ('DEBIT', 'CREDIT');

-- ── Structure ───────────────────────────────────────────────────────────────

CREATE TABLE "FeeCategory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "frequency" "FeeFrequency" NOT NULL DEFAULT 'PER_TERM',
  "isOptional" BOOLEAN NOT NULL DEFAULT false,
  "isCollectible" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeeCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeCategory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FeeCategory_schoolId_name_key" ON "FeeCategory"("schoolId", "name");
CREATE INDEX "FeeCategory_schoolId_idx" ON "FeeCategory"("schoolId");

CREATE TABLE "FeeTerm" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "academicYearId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "dueDate" DATE NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeeTerm_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeTerm_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeTerm_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FeeTerm_schoolId_academicYearId_name_key" ON "FeeTerm"("schoolId", "academicYearId", "name");
CREATE INDEX "FeeTerm_schoolId_academicYearId_idx" ON "FeeTerm"("schoolId", "academicYearId");

CREATE TABLE "FeePlan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "academicYearId" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeePlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeePlan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeePlan_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FeePlan_schoolId_academicYearId_version_key" ON "FeePlan"("schoolId", "academicYearId", "version");
CREATE INDEX "FeePlan_schoolId_academicYearId_idx" ON "FeePlan"("schoolId", "academicYearId");

CREATE TABLE "FeePlanItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "gradeId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  "termId" UUID,
  "amountMinor" INTEGER NOT NULL,
  CONSTRAINT "FeePlanItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeePlanItem_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeePlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "FeePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeePlanItem_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "Grade"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeePlanItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FeePlanItem_termId_fkey" FOREIGN KEY ("termId") REFERENCES "FeeTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Postgres treats NULLs as distinct in a UNIQUE index, so the "same in every
-- term" row (termId IS NULL) needs its own partial unique index or a school
-- could create two of them for the same cell.
CREATE UNIQUE INDEX "FeePlanItem_planId_gradeId_categoryId_termId_key" ON "FeePlanItem"("planId", "gradeId", "categoryId", "termId");
CREATE UNIQUE INDEX "FeePlanItem_cell_alltl_key" ON "FeePlanItem"("planId", "gradeId", "categoryId") WHERE "termId" IS NULL;
CREATE INDEX "FeePlanItem_schoolId_planId_idx" ON "FeePlanItem"("schoolId", "planId");
CREATE INDEX "FeePlanItem_schoolId_gradeId_idx" ON "FeePlanItem"("schoolId", "gradeId");
CREATE INDEX "FeePlanItem_schoolId_categoryId_idx" ON "FeePlanItem"("schoolId", "categoryId");
CREATE INDEX "FeePlanItem_schoolId_termId_idx" ON "FeePlanItem"("schoolId", "termId");

CREATE TABLE "FeeAssignment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "optInCategoryIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isRte" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeeAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "FeePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FeeAssignment_studentId_planId_key" ON "FeeAssignment"("studentId", "planId");
CREATE INDEX "FeeAssignment_schoolId_studentId_idx" ON "FeeAssignment"("schoolId", "studentId");
CREATE INDEX "FeeAssignment_schoolId_planId_idx" ON "FeeAssignment"("schoolId", "planId");

CREATE TABLE "FeeConcession" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "categoryId" UUID,
  "termId" UUID,
  "percentBps" INTEGER,
  "amountMinor" INTEGER,
  "reason" TEXT NOT NULL,
  "createdBy" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeeConcession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeConcession_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeConcession_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeConcession_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FeeCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeConcession_termId_fkey" FOREIGN KEY ("termId") REFERENCES "FeeTerm"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Exactly one of the two must be set. Enforced here as well as in the
  -- service, because a concession that is neither a percentage nor an amount
  -- silently waives nothing and is very hard to notice.
  CONSTRAINT "FeeConcession_one_basis" CHECK (
    ("percentBps" IS NOT NULL AND "amountMinor" IS NULL)
    OR ("percentBps" IS NULL AND "amountMinor" IS NOT NULL)
  ),
  CONSTRAINT "FeeConcession_pct_range" CHECK ("percentBps" IS NULL OR ("percentBps" > 0 AND "percentBps" <= 10000)),
  CONSTRAINT "FeeConcession_amt_positive" CHECK ("amountMinor" IS NULL OR "amountMinor" > 0)
);
CREATE INDEX "FeeConcession_schoolId_studentId_idx" ON "FeeConcession"("schoolId", "studentId");
CREATE INDEX "FeeConcession_schoolId_categoryId_idx" ON "FeeConcession"("schoolId", "categoryId");
CREATE INDEX "FeeConcession_schoolId_termId_idx" ON "FeeConcession"("schoolId", "termId");

-- ── Billing ─────────────────────────────────────────────────────────────────

CREATE TABLE "FeeInvoice" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "termId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "dueDate" DATE NOT NULL,
  "totalMinor" INTEGER NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "cancelledReason" TEXT,
  CONSTRAINT "FeeInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeInvoice_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeInvoice_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeInvoice_termId_fkey" FOREIGN KEY ("termId") REFERENCES "FeeTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FeeInvoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "FeePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- This is what makes "generate bills" safe to run twice.
CREATE UNIQUE INDEX "FeeInvoice_studentId_termId_key" ON "FeeInvoice"("studentId", "termId");
CREATE UNIQUE INDEX "FeeInvoice_schoolId_number_key" ON "FeeInvoice"("schoolId", "number");
CREATE INDEX "FeeInvoice_schoolId_termId_idx" ON "FeeInvoice"("schoolId", "termId");
CREATE INDEX "FeeInvoice_schoolId_studentId_idx" ON "FeeInvoice"("schoolId", "studentId");
CREATE INDEX "FeeInvoice_schoolId_dueDate_idx" ON "FeeInvoice"("schoolId", "dueDate");

CREATE TABLE "FeeInvoiceLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  "categoryName" TEXT NOT NULL,
  "categoryDescription" TEXT NOT NULL,
  "grossMinor" INTEGER NOT NULL,
  "concessionMinor" INTEGER NOT NULL DEFAULT 0,
  "netMinor" INTEGER NOT NULL,
  "concessionReason" TEXT,
  "isCollectible" BOOLEAN NOT NULL DEFAULT true,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "FeeInvoiceLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeInvoiceLine_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "FeeInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeInvoiceLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FeeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FeeInvoiceLine_net_math" CHECK ("netMinor" = "grossMinor" - "concessionMinor"),
  CONSTRAINT "FeeInvoiceLine_net_nonneg" CHECK ("netMinor" >= 0)
);
CREATE INDEX "FeeInvoiceLine_schoolId_invoiceId_idx" ON "FeeInvoiceLine"("schoolId", "invoiceId");
CREATE INDEX "FeeInvoiceLine_schoolId_categoryId_idx" ON "FeeInvoiceLine"("schoolId", "categoryId");

-- ── Collection ──────────────────────────────────────────────────────────────

CREATE TABLE "FeePayment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "invoiceId" UUID,
  "provider" TEXT NOT NULL DEFAULT 'MANUAL',
  "providerRef" TEXT,
  "method" "FeePaymentMethod" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "status" "FeePaymentStatus" NOT NULL DEFAULT 'SUBMITTED',
  "paidOn" DATE NOT NULL,
  "proofKey" TEXT,
  "note" TEXT,
  "submittedBy" UUID,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedBy" UUID,
  "verifiedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "reversedAt" TIMESTAMP(3),
  "reversedReason" TEXT,
  CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeePayment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeePayment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "FeeInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "FeePayment_amount_positive" CHECK ("amountMinor" > 0)
);
-- The duplicate-submission guard: the same UTR cannot be claimed twice at one
-- school. PARTIAL on providerRef IS NOT NULL, because cash has no reference
-- and two null refs must not collide.
--
-- NOT declared in schema.prisma: Prisma cannot express a partial index, and a
-- plain @@unique there would generate a DIFFERENT (full) index and read as
-- drift forever. The constraint lives here, and FeePaymentService relies on
-- catching its violation — see the duplicate-reference test.
CREATE UNIQUE INDEX "FeePayment_schoolId_provider_providerRef_key"
  ON "FeePayment"("schoolId", "provider", "providerRef")
  WHERE "providerRef" IS NOT NULL;
CREATE INDEX "FeePayment_schoolId_status_idx" ON "FeePayment"("schoolId", "status");
CREATE INDEX "FeePayment_schoolId_studentId_idx" ON "FeePayment"("schoolId", "studentId");
CREATE INDEX "FeePayment_schoolId_invoiceId_idx" ON "FeePayment"("schoolId", "invoiceId");
CREATE INDEX "FeePayment_schoolId_submittedAt_idx" ON "FeePayment"("schoolId", "submittedAt");

CREATE TABLE "FeeAllocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "invoiceLineId" UUID NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  CONSTRAINT "FeeAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeAllocation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FeePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "FeeInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeAllocation_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "FeeInvoiceLine"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeAllocation_amount_positive" CHECK ("amountMinor" > 0)
);
CREATE INDEX "FeeAllocation_schoolId_paymentId_idx" ON "FeeAllocation"("schoolId", "paymentId");
CREATE INDEX "FeeAllocation_schoolId_invoiceId_idx" ON "FeeAllocation"("schoolId", "invoiceId");
CREATE INDEX "FeeAllocation_schoolId_invoiceLineId_idx" ON "FeeAllocation"("schoolId", "invoiceLineId");

-- ── Truth ───────────────────────────────────────────────────────────────────

CREATE TABLE "FeeLedgerEntry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "kind" "FeeLedgerKind" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "refType" TEXT NOT NULL,
  "refId" UUID NOT NULL,
  "narration" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeeLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeLedgerEntry_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeLedgerEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeLedgerEntry_amount_positive" CHECK ("amountMinor" > 0)
);
CREATE INDEX "FeeLedgerEntry_schoolId_studentId_occurredAt_idx" ON "FeeLedgerEntry"("schoolId", "studentId", "occurredAt");
CREATE INDEX "FeeLedgerEntry_schoolId_refType_refId_idx" ON "FeeLedgerEntry"("schoolId", "refType", "refId");

-- Append-only, enforced by the database rather than by convention. The app
-- role can INSERT and SELECT; UPDATE and DELETE raise. The table owner (which
-- runs migrations) is unaffected, so a genuine data fix is still possible with
-- deliberate, privileged intent.
CREATE OR REPLACE FUNCTION "fee_ledger_append_only"() RETURNS TRIGGER AS $fn$
BEGIN
  RAISE EXCEPTION 'FeeLedgerEntry is append-only: % is not permitted. Post an opposing entry instead.', TG_OP;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER "fee_ledger_no_update" BEFORE UPDATE ON "FeeLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION "fee_ledger_append_only"();
CREATE TRIGGER "fee_ledger_no_delete" BEFORE DELETE ON "FeeLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION "fee_ledger_append_only"();

CREATE TABLE "FeeReceipt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "paymentId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeeReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeReceipt_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FeePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FeeReceipt_paymentId_key" ON "FeeReceipt"("paymentId");
CREATE UNIQUE INDEX "FeeReceipt_schoolId_number_key" ON "FeeReceipt"("schoolId", "number");
CREATE INDEX "FeeReceipt_schoolId_studentId_idx" ON "FeeReceipt"("schoolId", "studentId");

-- ── Configuration ───────────────────────────────────────────────────────────

CREATE TABLE "SchoolPaymentConfig" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB NOT NULL DEFAULT '{}',
  "secrets" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  "statusNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolPaymentConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolPaymentConfig_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SchoolPaymentConfig_schoolId_provider_key" ON "SchoolPaymentConfig"("schoolId", "provider");
CREATE INDEX "SchoolPaymentConfig_schoolId_idx" ON "SchoolPaymentConfig"("schoolId");

CREATE TABLE "SchoolBankDetail" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "accountName" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "ifsc" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "branch" TEXT,
  "upiId" TEXT,
  "upiQrKey" TEXT,
  "instructions" TEXT,
  "isVisible" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolBankDetail_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SchoolBankDetail_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SchoolBankDetail_schoolId_key" ON "SchoolBankDetail"("schoolId");

CREATE TABLE "FeeAudit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "actorId" UUID,
  "action" TEXT NOT NULL,
  "refType" TEXT NOT NULL,
  "refId" UUID NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "prevHash" TEXT,
  "hash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeeAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeAudit_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FeeAudit_schoolId_createdAt_idx" ON "FeeAudit"("schoolId", "createdAt");
CREATE INDEX "FeeAudit_schoolId_refType_refId_idx" ON "FeeAudit"("schoolId", "refType", "refId");

-- ── Receipt / invoice numbering ─────────────────────────────────────────────
-- Numbers come from the database, inside the caller's transaction, so two
-- clerks accepting a payment at the same instant cannot collide. A per-school
-- counter row locked with FOR UPDATE rather than a Postgres SEQUENCE, because
-- a sequence is global and these must restart per school per session and be
-- gap-free within their series.
CREATE TABLE "FeeCounter" (
  "schoolId" UUID NOT NULL,
  "series" TEXT NOT NULL,
  "value" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "FeeCounter_pkey" PRIMARY KEY ("schoolId", "series"),
  CONSTRAINT "FeeCounter_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE OR REPLACE FUNCTION "fee_next_number"(p_school UUID, p_series TEXT)
RETURNS INTEGER AS $fn$
DECLARE v INTEGER;
BEGIN
  INSERT INTO "FeeCounter" ("schoolId", "series", "value")
    VALUES (p_school, p_series, 1)
    ON CONFLICT ("schoolId", "series")
    DO UPDATE SET "value" = "FeeCounter"."value" + 1
    RETURNING "value" INTO v;
  RETURN v;
END;
$fn$ LANGUAGE plpgsql;

-- ── Row-level security ──────────────────────────────────────────────────────
-- Same tenant_iso policy every other tenant table carries, comparing schoolId
-- DIRECTLY. FeeCounter is included: it is per-school and reached through
-- withTenant like everything else.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'FeeCategory','FeeTerm','FeePlan','FeePlanItem','FeeAssignment','FeeConcession',
    'FeeInvoice','FeeInvoiceLine','FeePayment','FeeAllocation','FeeLedgerEntry',
    'FeeReceipt','SchoolPaymentConfig','SchoolBankDetail','FeeAudit','FeeCounter'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
