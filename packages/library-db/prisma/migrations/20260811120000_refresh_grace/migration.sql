-- Refresh grace window: distinguish a concurrent retry (double-tap, duplicate
-- tab, mobile retry-on-timeout) from theft when an already-rotated refresh
-- token is replayed.
--
-- `replacedByToken` stores the RAW replacement refresh token, not a hash of
-- it — `tokenHash` is one-way, so the raw value could never be recovered
-- from a hash, and a client replaying the parent needs a token it can
-- actually authenticate with. This column is therefore itself a live,
-- single-use bearer secret (the exact token the legitimate rotation winner
-- already holds) and is protected exactly like `tokenHash`: no RLS policy,
-- by design — "RefreshToken" is on the RLS audit's allow-list
-- (packages/library-db/src/rls-audit.ts, RLS_ALLOW_LIST) because it is
-- hash/token-keyed and single-use, with no tenant column to scope by, and it
-- is reachable only through the BYPASSRLS platform client.
ALTER TABLE "RefreshToken" ADD COLUMN     "replacedByToken" TEXT,
ADD COLUMN     "supersededAt" TIMESTAMP(3);
