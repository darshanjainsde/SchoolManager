-- One library Member per Sckools user, per org.
--
-- `externalRef` holds the Sckools `User.id` and is the join between the two
-- systems. It carried only `@@index([orgId, externalRef])` — a lookup index,
-- not a constraint — so nothing stopped two Member rows pointing at the same
-- child. Both would then accrue fines, both would appear in dues, and the
-- not-returned list would name the same person twice with different books.
-- Enrolment reads the roster, so a bug or a double-run is exactly how that
-- happens.
--
-- PARTIAL, because `externalRef` is nullable and must stay so: EXTERNAL members
-- (alumni, parents) have no Sckools user at all, and Postgres treats NULLs as
-- distinct, so a plain unique index would permit unlimited NULL rows anyway
-- while a NOT NULL column would delete external borrowers. The WHERE clause
-- says the real rule — "at most one row per (org, linked user)" — and leaves
-- unlinked members alone.
--
-- Same technique as `lost_report_one_open_per_copy` and the CirculationPolicy
-- org-default indexes: a partial unique index expressing a rule Prisma's
-- `@@unique` cannot.
CREATE UNIQUE INDEX IF NOT EXISTS "member_one_per_external_ref"
  ON "Member" ("orgId", "externalRef")
  WHERE "externalRef" IS NOT NULL;
