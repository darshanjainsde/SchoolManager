-- The register is append-only — but a school that is deleted outright
-- (owner console: suspend → delete) must take its register with it, and the
-- original guard refused even that cascade, so deleting any school with one
-- issued document failed with a raw trigger error. Found while deleting a
-- local fixture; the same held on prod.
--
-- The rule now: a register entry may leave ONLY when its whole school is
-- leaving. During a School cascade the parent row is already gone when the
-- child triggers fire, so "school no longer exists" identifies the cascade
-- exactly. A direct DELETE while the school lives — including a Student
-- cascade — is refused as before (the API refuses student deletion at the
-- service level first, with a human message; this is the belt under it).
CREATE OR REPLACE FUNCTION "press_issue_guard"() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM "School" WHERE "id" = OLD."schoolId") THEN
      RETURN OLD; -- the school itself is being deleted; the register goes with it
    END IF;
    RAISE EXCEPTION 'PressIssue is append-only — register entries are never deleted';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."schoolId" IS DISTINCT FROM OLD."schoolId"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."serial" IS DISTINCT FROM OLD."serial"
     OR NEW."studentId" IS DISTINCT FROM OLD."studentId"
     OR NEW."windowId" IS DISTINCT FROM OLD."windowId"
     OR NEW."payload"::text IS DISTINCT FROM OLD."payload"::text
     OR NEW."issuedById" IS DISTINCT FROM OLD."issuedById"
     OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" THEN
    RAISE EXCEPTION 'PressIssue is immutable — correct a wrong document by voiding it and issuing afresh';
  END IF;
  IF OLD."voidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'This register entry is already voided';
  END IF;
  IF NEW."voidedAt" IS NULL THEN
    RAISE EXCEPTION 'The only permitted update to a register entry is voiding it';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;
