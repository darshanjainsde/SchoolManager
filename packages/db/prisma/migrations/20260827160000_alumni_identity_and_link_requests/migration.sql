-- Two facts a school can CHECK, and a queue for "send me my link".
--
-- Alumni.dob / guardianName are carried from the Student record at graduation.
-- They exist so a self-registration can be matched by MACHINE rather than by a
-- clerk walking to a shelf: an alumnus reliably remembers their own birthday
-- and their father's name, and often does not remember whether they were in
-- 10-A or 10-B. Both are office-only and appear in no projection any audience
-- can reach — see alumni-portal.service.ts, which chooses its columns per
-- audience rather than fetching a row and pruning it.
--
-- AlumniLinkRequest exists because email does not work yet. A verified alumnus
-- who has lost their link asks for another; a row appears ONLY if the contact
-- matched somebody real, and the office presses one button to get a link to
-- paste into the batch WhatsApp group.

-- CreateEnum
CREATE TYPE "LinkRequestStatus" AS ENUM ('PENDING', 'SENT', 'DISMISSED');

-- AlterTable
ALTER TABLE "Alumni" ADD COLUMN     "dob" TIMESTAMP(3),
ADD COLUMN     "guardianName" TEXT;

-- AlterTable
ALTER TABLE "AlumniClaim" ADD COLUMN     "claimedClass" TEXT,
ADD COLUMN     "claimedDob" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AlumniLinkRequest" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "alumniId" UUID NOT NULL,
    "status" "LinkRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "sentByUserId" UUID,

    CONSTRAINT "AlumniLinkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlumniLinkRequest_schoolId_status_idx" ON "AlumniLinkRequest"("schoolId", "status");

-- CreateIndex
CREATE INDEX "AlumniLinkRequest_alumniId_idx" ON "AlumniLinkRequest"("alumniId");

-- AddForeignKey
ALTER TABLE "AlumniLinkRequest" ADD CONSTRAINT "AlumniLinkRequest_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniLinkRequest" ADD CONSTRAINT "AlumniLinkRequest_alumniId_fkey" FOREIGN KEY ("alumniId") REFERENCES "Alumni"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS, same shape as the other 70+ tenant tables.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "AlumniLinkRequest" ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'ALTER TABLE "AlumniLinkRequest" FORCE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_iso ON "AlumniLinkRequest";';
  EXECUTE 'CREATE POLICY tenant_iso ON "AlumniLinkRequest" USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));';
END $$;

-- One live request per alumnus. Somebody who taps "send me my link" three times
-- because nothing visibly happened is the NORMAL case, and three rows is a queue
-- the coordinator has to read three times to learn one thing.
CREATE UNIQUE INDEX "AlumniLinkRequest_one_pending_key"
  ON "AlumniLinkRequest" ("schoolId", "alumniId")
  WHERE "status" = 'PENDING';
