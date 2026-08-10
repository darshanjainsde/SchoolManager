-- Idempotent reconciliation for the init_identity migration rename.
--
-- 20260809190637_init_identity was renamed to 20260809000000_init_identity
-- (Task 12) because it sorted AFTER 20260809120000_rls_identity even though
-- it must run first — a fresh `prisma migrate deploy` applies migrations in
-- filename order, so it tried to enable RLS on tables that did not exist
-- yet. See the Task 12 report for the full story.
--
-- Prisma finds migrations by name in the `_prisma_migrations` bookkeeping
-- table, so any database that recorded the OLD name as applied — before
-- this fix landed — needs that row's name updated to the NEW one, or
-- `migrate status`/`migrate deploy` will conclude the migration was never
-- applied and try to CREATE TABLE over tables that already exist.
--
-- Safe to run unconditionally, in any order, any number of times:
--   - a database with the OLD name applied  -> renames the row (1 row)
--   - a database with the NEW name already  -> no-op (0 rows; WHERE matches nothing)
--   - a completely fresh database (no `_prisma_migrations` table yet, e.g.
--     before the first `migrate deploy`) -> no-op (guarded by to_regclass
--     below; skips instead of erroring "relation does not exist")
--
-- Run with:
--   pnpm --filter @library/db run reconcile:init-identity-rename
DO $$
BEGIN
  IF to_regclass('library._prisma_migrations') IS NOT NULL THEN
    UPDATE library._prisma_migrations
    SET migration_name = '20260809000000_init_identity'
    WHERE migration_name = '20260809190637_init_identity';
  END IF;
END $$;
