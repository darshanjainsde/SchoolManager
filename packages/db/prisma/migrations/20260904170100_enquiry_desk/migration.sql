-- The admissions desk: a next step, an owner, and a history.
--
-- Every column is additive and nullable, so existing rows are untouched and the
-- three-state page keeps working while this lands. CLOSED is deliberately NOT
-- rewritten to LOST: the desk reads it as lost, but rewriting history a school
-- may be asked about is not this migration's business.
ALTER TABLE "Enquiry" ADD COLUMN "followUpAt" DATE;
ALTER TABLE "Enquiry" ADD COLUMN "ownerUserId" UUID;
ALTER TABLE "Enquiry" ADD COLUMN "lostReason" TEXT;

-- The desk's own query: open leads for one school, ordered by when they are due.
CREATE INDEX "Enquiry_schoolId_status_followUpAt_idx"
  ON "Enquiry"("schoolId", "status", "followUpAt");

CREATE TABLE "EnquiryNote" (
  "id"           UUID NOT NULL,
  "schoolId"     UUID NOT NULL,
  "enquiryId"    UUID NOT NULL,
  "kind"         TEXT NOT NULL DEFAULT 'NOTE',
  "body"         TEXT NOT NULL,
  "authorUserId" UUID,
  "authorName"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnquiryNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EnquiryNote_schoolId_enquiryId_createdAt_idx"
  ON "EnquiryNote"("schoolId", "enquiryId", "createdAt");

ALTER TABLE "EnquiryNote"
  ADD CONSTRAINT "EnquiryNote_enquiryId_fkey"
  FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS, in the same shape every tenant table here uses. Supabase exposes the
-- whole public schema through its Data API, so a table without this is readable
-- by anyone holding the anon key — which is exactly what its scanner once found
-- on eight tables that a later migration had created outside the loop.
ALTER TABLE "EnquiryNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EnquiryNote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "EnquiryNote"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
