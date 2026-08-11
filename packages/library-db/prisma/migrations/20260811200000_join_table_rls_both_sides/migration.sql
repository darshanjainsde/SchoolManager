-- Fix (review finding 1, CRITICAL): the catalogue_rls migration's TitleAuthor
-- and TitleCategory policies only checked ONE side of the join —
-- `EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId")` never referenced
-- authorId/categoryId at all. A row from org A's Title joined to org B's
-- Author (or Category) passed WITH CHECK, because the check only asked "does
-- SOME Title with this id exist and is it visible to me" (true — it's org
-- A's own title) and never asked anything about the Author/Category side.
--
-- Reproduced live before this fix, as library_app scoped to org A:
--   INSERT INTO "TitleAuthor" (titleId, authorId, role)
--   VALUES (<org A's title>, <org B's author>, 'AUTHOR');
--   -- succeeded.
--
-- Why this matters beyond the write itself: TitleAuthor.author and
-- TitleCategory.category are ON DELETE CASCADE, so org B deleting their own
-- Author silently deletes an org-A TitleAuthor row it never should have been
-- able to create in the first place — a covert cross-tenant side channel.
--
-- Fix: both EXISTS clauses must hold, in both USING and WITH CHECK (USING
-- didn't have to change to close the write hole, but is fixed for symmetry
-- and defence in depth — a future read path must not disagree with the
-- write path about which rows are visible).

ALTER POLICY org_isolation ON "TitleAuthor"
  USING (
    EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId")
    AND EXISTS (SELECT 1 FROM "Author" a WHERE a.id = "authorId")
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId")
    AND EXISTS (SELECT 1 FROM "Author" a WHERE a.id = "authorId")
  );

ALTER POLICY org_isolation ON "TitleCategory"
  USING (
    EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId")
    AND EXISTS (SELECT 1 FROM "Category" c WHERE c.id = "categoryId")
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "Title" t WHERE t.id = "titleId")
    AND EXISTS (SELECT 1 FROM "Category" c WHERE c.id = "categoryId")
  );
