-- Who minted an impersonation link.
--
-- Without this the audit trail cannot attribute what an operator did inside a
-- school. The exchange mints a school JWT whose `sub` is the school admin, so
-- AuditInterceptor recorded every subsequent action as that admin's OWN work.
-- The `imp: true` claim existed but was read only by the browser, to draw a
-- banner — nothing server-side recorded it.
--
-- Nullable and additive: rows minted before this migration simply have no
-- attribution, which is honest, and nothing reads it as required.
ALTER TABLE "ImpersonationToken"
  ADD COLUMN IF NOT EXISTS "mintedByUserId" UUID;

-- The owner is a platform user (schoolId NULL) and this table is tenant-scoped,
-- so this is deliberately NOT a foreign key: the reference crosses the tenant
-- boundary, and an FK here would either fail RLS or force a cascade we do not
-- want. It is an attribution record, not a relation.
COMMENT ON COLUMN "ImpersonationToken"."mintedByUserId" IS
  'Platform user who minted this link. No FK: crosses the tenant boundary.';
