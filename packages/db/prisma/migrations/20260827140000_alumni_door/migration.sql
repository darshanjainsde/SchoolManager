-- The alumnus's door.
--
-- One table, no password column anywhere. An alumnus touches this product
-- perhaps three times a year, and a password used three times a year is not a
-- security measure — it is the reason the second visit never happens. So the
-- LINK is the credential: signed, single-use, expiring, tied to one Alumni row,
-- and pasted into a batch WhatsApp group by the office.
--
-- Only the sha256 hash is stored, exactly as PasswordResetToken does it. The
-- raw token lives in the link and nowhere else, so a database dump does not
-- hand anyone a working key.
--
-- The credential is deliberately weak on its own, and that is safe. Possessing
-- a link buys the directory and nothing more. Everything carrying real risk is
-- gated on a flag a HUMAN grants: VERIFIED to appear at all, trustedForStudents
-- to go anywhere near a child, and the office's own accept/receive/distribute
-- states for anything involving money or goods.

-- CreateEnum
CREATE TYPE "AlumniTokenKind" AS ENUM ('CLAIM', 'SESSION');

-- CreateTable
CREATE TABLE "AlumniAccessToken" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "alumniId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" "AlumniTokenKind" NOT NULL DEFAULT 'CLAIM',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlumniAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlumniAccessToken_tokenHash_key" ON "AlumniAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AlumniAccessToken_schoolId_alumniId_idx" ON "AlumniAccessToken"("schoolId", "alumniId");

-- CreateIndex
CREATE INDEX "AlumniAccessToken_expiresAt_idx" ON "AlumniAccessToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "AlumniAccessToken" ADD CONSTRAINT "AlumniAccessToken_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlumniAccessToken" ADD CONSTRAINT "AlumniAccessToken_alumniId_fkey" FOREIGN KEY ("alumniId") REFERENCES "Alumni"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- RLS, the same shape as the other 70+ tenant tables.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE "AlumniAccessToken" ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'ALTER TABLE "AlumniAccessToken" FORCE ROW LEVEL SECURITY;';
  EXECUTE 'DROP POLICY IF EXISTS tenant_iso ON "AlumniAccessToken";';
  EXECUTE 'CREATE POLICY tenant_iso ON "AlumniAccessToken" USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));';
END $$;

-- A token nobody redeemed is rubbish after it expires, and rubbish that holds a
-- secret hash is worth deleting rather than keeping. The index makes the sweep
-- cheap; the sweep itself is a later job, not a scheduler dependency
-- (LIBRARY-TRAPS #7 — no state transition may depend on a cron).
