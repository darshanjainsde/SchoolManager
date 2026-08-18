-- Website Studio: scroll feel, nav menu animation, hero video, per-section
-- variants, festive overlay, footer config, custom-code escape hatch — plus
-- design drafts (with a read-time schedule window) and admin-built pages.
--
-- Every new SchoolProfile column defaults to exactly what every school renders
-- today, or to NULL meaning "feature untouched" — shipping this repaints nobody.

-- AlterTable
ALTER TABLE "SchoolProfile" ADD COLUMN "scrollFeel" TEXT NOT NULL DEFAULT 'CLASSIC';
ALTER TABLE "SchoolProfile" ADD COLUMN "navDropdownAnim" TEXT NOT NULL DEFAULT 'FADE';
ALTER TABLE "SchoolProfile" ADD COLUMN "heroMedia" TEXT NOT NULL DEFAULT 'IMAGE';
ALTER TABLE "SchoolProfile" ADD COLUMN "heroVideoUrl" TEXT;
ALTER TABLE "SchoolProfile" ADD COLUMN "sectionVariants" JSONB;
ALTER TABLE "SchoolProfile" ADD COLUMN "festiveTheme" JSONB;
ALTER TABLE "SchoolProfile" ADD COLUMN "footerConfig" JSONB;
ALTER TABLE "SchoolProfile" ADD COLUMN "customSectionCss" JSONB;
ALTER TABLE "SchoolProfile" ADD COLUMN "customHtmlBlock" TEXT;

-- CreateTable: a saved website look. The [publishAt, revertAt] window is a
-- read-time overlay in the public projection — no scheduler, no state
-- transition (trap #7: OVERDUE-style states are computed at read time).
CREATE TABLE "DesignDraft" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "publishAt" TIMESTAMP(3),
    "revertAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DesignDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable: admin-built extra pages of typed blocks, served at /p/<slug>.
CREATE TABLE "SchoolPage" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the public read's hot path — "is a schedule window active now".
CREATE INDEX "DesignDraft_schoolId_publishAt_idx" ON "DesignDraft"("schoolId", "publishAt");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPage_schoolId_slug_key" ON "SchoolPage"("schoolId", "slug");
CREATE INDEX "SchoolPage_schoolId_order_idx" ON "SchoolPage"("schoolId", "order");

-- AddForeignKey
ALTER TABLE "DesignDraft" ADD CONSTRAINT "DesignDraft_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolPage" ADD CONSTRAINT "SchoolPage_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: own-tenant read/write via the direct "schoolId" (pattern copied
-- verbatim from 20260801000000_notifications). GRANTs are covered by the
-- ALTER DEFAULT PRIVILEGES set up in 20260703_000100_rls_and_roles.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['DesignDraft', 'SchoolPage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_iso ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_iso ON %I USING ("schoolId"::text = current_setting(''app.current_tenant'', true)) WITH CHECK ("schoolId"::text = current_setting(''app.current_tenant'', true));',
      t
    );
  END LOOP;
END $$;
