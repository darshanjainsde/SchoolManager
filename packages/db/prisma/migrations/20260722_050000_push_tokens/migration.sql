-- CreateTable
CREATE TABLE "PushToken" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_schoolId_email_idx" ON "PushToken"("schoolId", "email");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: own-tenant read/write (GRANTs auto-applied via ALTER DEFAULT PRIVILEGES
-- set up in 20260703_000100_rls_and_roles, which covers every table created
-- afterwards).
ALTER TABLE "PushToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PushToken" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_iso ON "PushToken"
  USING ("schoolId"::text = current_setting('app.current_tenant', true))
  WITH CHECK ("schoolId"::text = current_setting('app.current_tenant', true));
