-- The fee ledger is append-only — and, exactly like the Press register before
-- it (20260903120000), the guard was absolute enough to block the one delete
-- that is legitimate: the School cascade. Deleting a school with any fee
-- history failed with "FeeLedgerEntry is append-only", so the owner console's
-- suspend → delete path 500'd on every school that had ever billed a rupee,
-- and staging's demo school could not be rebuilt.
--
-- The rule now matches the register's: an entry may leave ONLY when its whole
-- school is leaving. During a School cascade the parent row is already gone
-- when child triggers fire, so "school no longer exists" identifies exactly
-- that case. Every other DELETE — including a single student's — is still
-- refused, because a child's financial history must not vanish with their row.
-- UPDATE stays forbidden outright: correction is an opposing entry.
CREATE OR REPLACE FUNCTION "fee_ledger_append_only"() RETURNS TRIGGER AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "School" WHERE "id" = OLD."schoolId") THEN
      RETURN OLD; -- the school itself is going; its ledger goes with it
    END IF;
  END IF;
  RAISE EXCEPTION 'FeeLedgerEntry is append-only: % is not permitted. Post an opposing entry instead.', TG_OP;
END;
$fn$ LANGUAGE plpgsql;
