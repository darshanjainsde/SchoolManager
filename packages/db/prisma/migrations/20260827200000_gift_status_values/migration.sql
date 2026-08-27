-- The three new GiftStatus values, ALONE in their own migration.
--
-- Postgres refuses to use an enum value in the same transaction that added it,
-- and Prisma runs each migration in one transaction. Anything that inserts or
-- compares against 'PICKED_UP' therefore has to land in a LATER migration than
-- this one. Adding them beside the tables that use them is the shape that
-- fails, and it fails on the deploy rather than here.
--
-- What they mean, and which track each belongs to:
--   PICKUP_REQUESTED  goods only — somebody asked for the consignment to be
--                     collected; the address lives on the pledge
--   PICKED_UP         goods only — in transit, with a courier and reference
--                     if there is one; a hand-carried gift skips this
--   PURCHASED         money only — the school has bought the thing the money
--                     was given for
--
-- Both tracks converge on the RECEIVED that already exists: for money it means
-- the funds landed, for goods it means the school confirmed they arrived.
ALTER TYPE "GiftStatus" ADD VALUE IF NOT EXISTS 'PICKUP_REQUESTED';
ALTER TYPE "GiftStatus" ADD VALUE IF NOT EXISTS 'PICKED_UP';
ALTER TYPE "GiftStatus" ADD VALUE IF NOT EXISTS 'PURCHASED';
