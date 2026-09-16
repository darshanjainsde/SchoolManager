-- Reserve a BLOCK of invoice numbers in one statement.
--
-- WHY. `generate()` bills a whole term inside ONE withTenant transaction, and
-- called fee_next_number() once per student — plus an invoice insert and a
-- ledger insert. Three sequential round trips per child, in a transaction whose
-- timeout is 10 seconds and which holds a pgbouncer client for its whole life.
--
-- Measured on production (api.sckools.com, 2026-09-16): the difference between
-- /health (no database work) and /public/site (13 queries inside one
-- withTenant) is 92 ms across ~16 round trips — 5.8 ms per round trip including
-- query execution. Writes are cheaper than that read; at a conservative 3 ms:
--
--     800 students x 3 round trips x 3 ms  =  7.2 s   (survives)
--   1,500 students x 3 round trips x 3 ms  = 13.5 s   (FAILS, rolls back)
--
-- So a school somewhere between 800 and 1,500 children cannot bill at all, and
-- the failure arrives with no code change to blame it on — just growth. That is
-- the same shape as the attendance outage the August scale work found.
--
-- Billing is also SEASONAL: every school bills in the same few days at the start
-- of a term. The transaction pooler tops out around 200 clients, so the cost is
-- not one slow school, it is fifty schools each pinning a client for ten seconds
-- in the same hour.
--
-- WHAT THIS CHANGES. Nothing about how a number is produced. The counter is
-- still a single atomic upsert-increment; it now advances by `p_count` instead
-- of by 1 and returns the FIRST number of the reserved run, so the caller can
-- number N invoices without asking N times.
--
-- Gap-free behaviour is unchanged. The increment happens inside the caller's
-- transaction, so if the billing run rolls back the counter rolls back with it —
-- exactly as it does today. A reserved block is either fully used or fully
-- discarded, because it is reserved and consumed in the same transaction.
CREATE OR REPLACE FUNCTION "fee_next_block"(p_school UUID, p_series TEXT, p_count INTEGER)
RETURNS INTEGER AS $fn$
DECLARE v INTEGER;
BEGIN
  IF p_count IS NULL OR p_count < 1 THEN
    RAISE EXCEPTION 'fee_next_block: p_count must be >= 1, got %', p_count;
  END IF;
  INSERT INTO "FeeCounter" ("schoolId", "series", "value")
    VALUES (p_school, p_series, p_count)
    ON CONFLICT ("schoolId", "series")
    DO UPDATE SET "value" = "FeeCounter"."value" + p_count
    RETURNING "value" INTO v;
  -- `v` is the LAST number in the block; the caller starts here.
  RETURN v - p_count + 1;
END;
$fn$ LANGUAGE plpgsql;

-- fee_next_number() stays exactly as it was. The counter press and anything
-- else issuing one number at a time still calls it, and it is now simply
-- fee_next_block(school, series, 1) by another name.
