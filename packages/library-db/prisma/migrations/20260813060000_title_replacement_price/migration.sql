-- What a parent is asked to pay when a book is lost.
--
-- `Copy.acquisitionCost` already exists and is NOT this number. It is what the
-- school paid, from the bill, per physical copy, and it is historic: the ₹45
-- paid for a copy in 1998 is not what it costs to buy that book again today.
-- It is also nullable on most real stock, so P3 (lost books) had nothing to
-- charge against — "what does this parent owe" resolved to null, which is why
-- that phase was blocked on this column.
--
-- Title-level, not copy-level, deliberately. A replacement is bought at
-- today's market price, which is one number per book, not per physical copy —
-- and a per-copy column would have to be kept in sync by hand across every
-- copy of every title, forever, to serve the minority of titles whose editions
-- genuinely differ in price. Where they do differ, the loss screen lets the
-- librarian type the real number for that one loss (P3), which is a keystroke
-- rather than a maintenance tax.
--
-- Nullable on purpose. A school onboarding four thousand existing books starts
-- with this unset everywhere, and "unpriced" has to be a legitimate, visible
-- state: a missing price must never block RECORDING a loss, because reporting
-- a loss is what stops the daily late charge growing (§2.4 of the spec). Only
-- the money can be deferred, never the report.
ALTER TABLE "Title" ADD COLUMN "replacementPrice" DECIMAL(10,2);

-- Integrity, not policy — which is why it is here and not only in the DTO.
-- A negative replacement price would CREDIT a parent's account for losing a
-- book, and no code path anywhere should be able to produce one, including a
-- future import, a future admin script, or a hand-written UPDATE. Governing
-- decision 8: guarantees live in the database.
--
-- Only the lower bound is enforced here. The upper bound the API validates
-- (₹100000, a fat-finger guard against `29900` typed for `299.00`) is a
-- business judgement that a school with a genuinely expensive reference set
-- could need relaxed, and relaxing a CHECK costs a migration; relaxing a
-- decorator does not. `NULL` passes, because unpriced is legitimate — a bare
-- `>= 0` CHECK would already allow NULL under three-valued logic, but it is
-- written out so the intent is not something a reader has to re-derive.
ALTER TABLE "Title" ADD CONSTRAINT "Title_replacementPrice_nonnegative"
  CHECK ("replacementPrice" IS NULL OR "replacementPrice" >= 0);

-- No RLS change. `Title` already carries the org_isolation policy added in
-- 20260811190100_catalogue_rls, policies are row-level rather than
-- column-level, and a new column on an already-protected table inherits that
-- protection unchanged. Nothing is added to RLS_ALLOW_LIST and the coverage
-- audit's result is identical before and after this migration.
--
-- No search-vector change either. `Title.searchVector` is a GENERATED ALWAYS
-- ... STORED column over the TEXT columns only; a price is not something
-- anyone searches for by typing it, and adding a numeric to a tsvector would
-- make "299" match every ₹299 book in the school.
