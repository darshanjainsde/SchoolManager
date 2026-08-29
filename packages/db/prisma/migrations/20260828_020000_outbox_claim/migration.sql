-- Let a drain take ownership of a row.
--
-- The drain previously selected unsent rows with a plain findMany. That was
-- safe only because the cron ran once a day, so two drains could never overlap.
-- Moving the cron to once a minute makes overlap routine, and two drains
-- reading the same batch would both send it — turning the documented rare
-- at-least-once duplicate into a regular one.
--
-- claimedAt is stamped inside the same statement that selects the batch, using
-- FOR UPDATE SKIP LOCKED, so a second drain skips already-claimed rows instead
-- of blocking on them.
ALTER TABLE "NotificationOutbox" ADD COLUMN "claimedAt" TIMESTAMP(3);

-- The claim query's own shape: unsent, unclaimed (or abandoned), oldest first.
CREATE INDEX "NotificationOutbox_sentAt_claimedAt_createdAt_idx"
  ON "NotificationOutbox" ("sentAt", "claimedAt", "createdAt");
