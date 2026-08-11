import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');

describe('library schema invariants', () => {
  it('generates into its own client directory, never the shared default', () => {
    expect(schema).toMatch(/output\s*=\s*"\.\.\/generated\/client"/);
  });

  it('never stores a time-derived status the way a scheduler would need', () => {
    // OVERDUE / EXPIRING / EXPIRED must never be a stored, clock-driven
    // STATUS — one a cron would have to flip (Vercel Hobby permits daily
    // crons only; a missed run would then corrupt state). That guarantee
    // applies to enums that represent a status, every one of which is named
    // `...Status` in this schema (LoanStatus, HoldStatus, CopyStatus,
    // MemberStatus, OrgStatus, LibDomainStatus, FineStatus).
    //
    // Scoped to `...Status` enum bodies rather than the whole file, because
    // `FineKind` (task 4, circulation) legitimately has an `OVERDUE` value —
    // it labels WHY a fine was charged (overdue vs. damage vs. lost vs.
    // other), set once at Fine-creation time by application code and never
    // flipped by a clock; it is a category, not a status. Narrowing the
    // match to `...Status` enums is strictly the same check for every enum
    // the guarantee is actually about — see the regression test directly
    // below, which proves this scoping still catches the case the check
    // exists for.
    const statusEnumBodies = [...schema.matchAll(/enum \w*Status \{([^}]*)\}/g)].map((m) => m[1]);
    // Guards against the check going vacuous if every status enum were ever
    // renamed away from the `...Status` convention.
    expect(statusEnumBodies.length).toBeGreaterThan(0);
    for (const body of statusEnumBodies) {
      for (const forbidden of ['OVERDUE', 'EXPIRING', 'EXPIRED']) {
        expect(body).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
      }
    }
  });

  it('regression: the status-enum guard above still catches a forbidden value (proves the scoping above is not vacuous)', () => {
    const poisoned = schema.replace('enum LoanStatus {\n  ACTIVE', 'enum LoanStatus {\n  OVERDUE\n  ACTIVE');
    expect(poisoned).not.toBe(schema); // the replace actually matched something
    const statusEnumBodies = [...poisoned.matchAll(/enum \w*Status \{([^}]*)\}/g)].map((m) => m[1]);
    const caught = statusEnumBodies.some((body) => /\bOVERDUE\b/.test(body));
    expect(caught).toBe(true);
  });

  it('keeps Member.externalRef so the Sckools merge needs no migration', () => {
    expect(schema).toMatch(/externalRef\s+String\?/);
  });

  it('keeps LibUser and Member as separate tables', () => {
    expect(schema).toMatch(/^model LibUser \{/m);
    expect(schema).toMatch(/^model Member \{/m);
  });
});
