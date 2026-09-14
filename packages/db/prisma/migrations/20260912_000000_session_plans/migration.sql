-- Sessions / year end (Active Roster, Track C). See
-- docs/superpowers/specs/2026-09-09-active-roster-celebrations-sessions-design.md §4, §5.
--
-- Additive only: two enums and two new tables. Nothing existing changes, so
-- this is safe to apply to production BEFORE the code that reads it deploys
-- (the API degrades with isSchemaMissing until then).

CREATE TYPE "SessionPlanStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'STARTED', 'CANCELLED');
CREATE TYPE "SessionDecisionKind" AS ENUM ('PROMOTE', 'STAY', 'PASS_OUT', 'LEAVE');

CREATE TABLE "SessionPlan" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "fromYearId" UUID NOT NULL,
  "toYearId" UUID NOT NULL,
  "status" "SessionPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "passMarkPct" INTEGER NOT NULL DEFAULT 33,
  "countExamIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "sectionMap" JSONB NOT NULL DEFAULT '{}',
  "rollPolicy" TEXT NOT NULL DEFAULT 'KEEP',
  "copyTimetable" BOOLEAN NOT NULL DEFAULT true,
  "carryLeave" BOOLEAN NOT NULL DEFAULT true,
  "scheduledFor" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "startedById" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionPlan_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionPlan_fromYearId_fkey" FOREIGN KEY ("fromYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionPlan_toYearId_fkey" FOREIGN KEY ("toYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SessionPlan_schoolId_status_idx" ON "SessionPlan"("schoolId", "status");

CREATE TABLE "SessionDecision" (
  "id" UUID NOT NULL,
  "schoolId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "decision" "SessionDecisionKind" NOT NULL,
  "toSectionId" UUID,
  "fromSectionId" UUID,
  "leaveStatus" "StudentStatus",
  "leaveReason" TEXT,
  "note" TEXT,
  "decidedById" UUID NOT NULL,
  "appliedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SessionDecision_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionDecision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SessionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SessionDecision_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SessionDecision_planId_studentId_key" ON "SessionDecision"("planId", "studentId");
CREATE INDEX "SessionDecision_schoolId_planId_idx" ON "SessionDecision"("schoolId", "planId");

-- Tenant isolation: the same tenant_iso policy every other per-school table
-- carries (loop form, as in 20260824090000_rls_coverage_gap). Role grants
-- arrive through ALTER DEFAULT PRIVILEGES from the rls_and_roles migration.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SessionPlan','SessionDecision'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
