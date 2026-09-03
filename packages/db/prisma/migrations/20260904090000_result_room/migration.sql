-- The Result Room: report-card generation gets a cockpit.
--   Result.status  — PRESENT | AB | EX (TEXT, validated at write). Absent and
--                    exempted become facts instead of blanks; AB stores 0 but
--                    prints "AB", EX leaves the max out of the percentage.
--   ReportWindow.resultDay — the date scores are due; teachers see it, the
--                    room counts down to it.
--   ReportRemark.extras — the card's optional blocks (co-scholastic, house,
--                    height/weight, promotion), per child per window.
--   SchoolProfile.certVariant — CBSE | CISCE | STATE certificate face.
--   ResultNudge   — the nudge log, so an admin never nags twice by accident.
ALTER TABLE "Result" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PRESENT';
ALTER TABLE "ReportWindow" ADD COLUMN "resultDay" DATE;
ALTER TABLE "ReportRemark" ADD COLUMN "extras" JSONB;
ALTER TABLE "SchoolProfile" ADD COLUMN "certVariant" TEXT;

CREATE TABLE "ResultNudge" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schoolId" UUID NOT NULL,
  "windowId" UUID NOT NULL,
  "classSectionId" UUID NOT NULL,
  "subjectId" UUID NOT NULL,
  "teacherUserId" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "sentById" UUID NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResultNudge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResultNudge_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ResultNudge_schoolId_windowId_classSectionId_subjectId_idx"
  ON "ResultNudge"("schoolId", "windowId", "classSectionId", "subjectId");

ALTER TABLE "ResultNudge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ResultNudge" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "ResultNudge"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
