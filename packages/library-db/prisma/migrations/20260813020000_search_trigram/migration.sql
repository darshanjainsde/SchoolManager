-- Typo tolerance for the one search box.
--
-- With no scanner, search IS the counter. A librarian half-remembering a title
-- should not be punished for it: "hungy" must still find The Hungry Tide.
-- Full-text search cannot do that — it matches whole lexemes, so a misspelt
-- word simply is not the word. Trigram similarity can.
--
-- The indexes are GIN over the trigrams of the fields people actually mistype:
-- a book's title and a person's name. Author is covered through Author.sortName.
-- Without them, `similarity()` still WORKS but degrades to a sequential scan
-- over every title in the org, which is fine at 500 books and not at 50,000.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "title_title_trgm"  ON "Title" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "author_sort_trgm"  ON "Author" USING GIN ("sortName" gin_trgm_ops);
CREATE INDEX "member_first_trgm" ON "Member" USING GIN ("firstName" gin_trgm_ops);
CREATE INDEX "member_last_trgm"  ON "Member" USING GIN ("lastName" gin_trgm_ops);
