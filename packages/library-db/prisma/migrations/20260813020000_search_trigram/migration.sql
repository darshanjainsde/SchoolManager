-- Typo tolerance for the one search box.
--
-- With no scanner, search IS the counter. A librarian half-remembering a title
-- should not be punished for it: "hungy" must still find The Hungry Tide.
-- Full-text cannot do that — it matches whole lexemes, so a misspelt word
-- simply is not the word. Trigram similarity can.
--
-- TWO things here are load-bearing and were both got wrong first time:
--
-- 1. The QUERY must use the `<%` operator, not `word_similarity(a,b) > x`.
--    Only the operator can use a gin_trgm_ops index; the function call is
--    opaque to the planner. Proven on this database with enable_seqscan=off:
--    the operator gives `Bitmap Index Scan on title_title_trgm`, the function
--    still gives `Seq Scan`. Without that, every 4-character query scans every
--    title, author and member in the org — the exact thing these indexes exist
--    to prevent.
--
-- 2. WHERE the extension lives. `CREATE EXTENSION IF NOT EXISTS pg_trgm` puts
--    it in the first schema on the current search_path — which is `library`
--    locally. On Supabase pg_trgm is usually ALREADY installed in `extensions`,
--    so IF NOT EXISTS silently does nothing, and then neither `gin_trgm_ops`
--    nor `<%` resolves for a connection whose search_path is just `library`:
--    this migration fails at CREATE INDEX, or worse passes as the superuser and
--    every search 500s at runtime for the app role. That shows up only on a
--    genuinely fresh cloud deploy.
--
--    So: find where it actually is, and put it on the app roles' search_path
--    rather than assuming.

DO $$
DECLARE ext_schema text;
BEGIN
  SELECT n.nspname INTO ext_schema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_trgm';

  IF ext_schema IS NULL THEN
    EXECUTE 'CREATE EXTENSION pg_trgm SCHEMA library';
    ext_schema := 'library';
  END IF;

  -- Both roles must resolve the operator and the opclass, wherever it lives.
  EXECUTE format('ALTER ROLE library_app      SET search_path = library, %I, public', ext_schema);
  EXECUTE format('ALTER ROLE library_platform SET search_path = library, %I, public', ext_schema);

  -- And this migration's own session, so the CREATE INDEX below resolves the
  -- opclass even when the extension is somewhere else.
  EXECUTE format('SET LOCAL search_path = library, %I, public', ext_schema);

  EXECUTE 'CREATE INDEX IF NOT EXISTS "title_title_trgm"  ON "Title"  USING GIN ("title"     gin_trgm_ops)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS "author_sort_trgm"  ON "Author" USING GIN ("sortName"  gin_trgm_ops)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS "member_first_trgm" ON "Member" USING GIN ("firstName" gin_trgm_ops)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS "member_last_trgm"  ON "Member" USING GIN ("lastName"  gin_trgm_ops)';
END $$;
