-- The link back to Sckools, added before the library ever holds real data.
--
-- The merge plan (design §13) is one LibraryOrg per Sckools School. This is
-- that column. It stays NULL while the library runs standalone, which is the
-- normal state today and must keep working: nothing in the service reads it
-- yet, and no code path requires it to be set.
--
-- The reason it lands NOW rather than at merge time is cost. Adding a column
-- and a unique index to LibraryOrg once real schools exist means an ALTER on
-- the table every single request resolves a tenant against. Adding it to an
-- empty table costs nothing, and the column is three bytes of nullable UUID
-- until it is used.
--
-- UNIQUE on a nullable column is safe in Postgres: NULLs are not equal to each
-- other, so any number of unlinked orgs coexist, while a linked School can only
-- ever map to one library.
--
-- No RLS change needed: LibraryOrg's isolation is unchanged, and this column is
-- covered by the existing row-level policies like every other column on it.

ALTER TABLE "LibraryOrg" ADD COLUMN "schoolId" UUID;

-- Name matches what Prisma generates for @unique, so `migrate status` and
-- `db pull` stay in agreement with this hand-written migration.
CREATE UNIQUE INDEX "LibraryOrg_schoolId_key" ON "LibraryOrg"("schoolId");
