-- Let a school set its own late-fee rule.
--
-- Stored as a RULE, not as charges. The fee a parent owes is computed from
-- (rule, due date, today) at the moment it is looked at — see
-- apps/api/src/modules/fees/late-fee.ts. That is why there is no job here and
-- no per-bill amount column: a nightly job that writes fee rows charges the
-- parent who paid at 9am for a run at 2am, and makes the amount depend on
-- whether the job ran at all.
--
-- One row per school, created on first read, exactly like LibrarySettings.

CREATE TYPE "LateFeeMode" AS ENUM ('NONE', 'FLAT', 'PER_DAY');

CREATE TABLE "FeeSettings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "lateFeeMode" "LateFeeMode" NOT NULL DEFAULT 'NONE',
  "lateFeeAmountMinor" INTEGER NOT NULL DEFAULT 0,
  "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 0,
  "lateFeeCapMinor" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FeeSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeeSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeeSettings_amount_nonneg" CHECK ("lateFeeAmountMinor" >= 0),
  CONSTRAINT "FeeSettings_grace_nonneg" CHECK ("lateFeeGraceDays" >= 0 AND "lateFeeGraceDays" <= 365),
  CONSTRAINT "FeeSettings_cap_nonneg" CHECK ("lateFeeCapMinor" >= 0)
);
CREATE UNIQUE INDEX "FeeSettings_schoolId_key" ON "FeeSettings"("schoolId");

-- Same tenant_iso policy as the other sixteen fee tables.
ALTER TABLE "FeeSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeeSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "FeeSettings"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
