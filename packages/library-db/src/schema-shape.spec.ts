import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');

/**
 * `OVERDUE` / `EXPIRING` / `EXPIRED` as an enum value is forbidden by
 * default (see the guard test below) because it is almost always a
 * clock-driven status a SCHEDULER would have to flip — and Vercel Hobby
 * permits daily crons only, so a missed run then corrupts state (trap 7,
 * docs/superpowers/LIBRARY-TRAPS.md).
 *
 * A first version of this guard tried to infer "is this actually a status"
 * from the enum's NAME (only scanning enums ending in `...Status`). Review
 * correctly rejected that: an enum like `SubscriptionState` or `LoanPhase`
 * would carry the exact same time-derived-status risk while being
 * completely invisible to a name-based scan. This file now scans EVERY
 * enum in the schema, regardless of name, and carries this small, explicit,
 * by-name exception list instead — the same shape as `RLS_ALLOW_LIST` in
 * `rls-audit.ts`. An entry here must be added deliberately and is visible
 * in review; a naming convention is not. Do not add an entry to make a real
 * regression disappear — each one below is defended on its own terms.
 */
export const FORBIDDEN_VALUE_EXCEPTIONS: Array<{ enumName: string; value: string; reason: string }> = [
  {
    enumName: 'FineKind',
    value: 'OVERDUE',
    reason:
      'A fine CATEGORY (why it was charged: overdue vs. damage vs. lost vs. other), set once at ' +
      'Fine-creation time by application code. Never flipped by a clock — it is a reason, not a status.',
  },
  {
    enumName: 'ReservationStatus',
    value: 'EXPIRED',
    reason:
      'A terminal status set by a USER-TRIGGERED ACTION (the sweep that runs on the next return for ' +
      "that title), never by a scheduler in the absence of a request. expiresAt remains the source of " +
      'truth for "has this reservation lapsed yet" before that sweep runs. Without a value distinct from ' +
      'CANCELLED, "how many reservations went unclaimed" becomes unanswerable from stored data — restored ' +
      'after review finding 2 flagged that reporting regression.',
  },
];

describe('library schema invariants', () => {
  it('generates into its own client directory, never the shared default', () => {
    expect(schema).toMatch(/output\s*=\s*"\.\.\/generated\/client"/);
  });

  it('never stores a time-derived status the way a scheduler would need, unless explicitly reviewed and allow-listed', () => {
    const enumBlocks = [...schema.matchAll(/enum (\w+) \{([^}]*)\}/g)].map((m) => ({ name: m[1], body: m[2] }));
    // Guards against the whole check going vacuous — e.g. the schema file
    // failing to load, or every `enum` keyword somehow being renamed away.
    expect(enumBlocks.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const { name, body } of enumBlocks) {
      for (const forbidden of ['OVERDUE', 'EXPIRING', 'EXPIRED']) {
        if (!new RegExp(`\\b${forbidden}\\b`).test(body)) continue;
        const exempt = FORBIDDEN_VALUE_EXCEPTIONS.some((e) => e.enumName === name && e.value === forbidden);
        if (!exempt) violations.push(`${name}.${forbidden}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('regression: an enum whose name does NOT end in "Status" is still caught (proves the scan is not name-scoped)', () => {
    // The original bug this guards against: a naming-convention-based scan
    // (only checking `...Status`-named enums) is blind to a status-shaped
    // enum with any other name. Poison the schema with exactly that shape —
    // `SubscriptionState`, not `...Status`, not in the exception list — and
    // confirm the broad, name-agnostic scan still flags it.
    const poisoned = `${schema}\n\nenum SubscriptionState {\n  ACTIVE\n  EXPIRED\n}\n`;
    const enumBlocks = [...poisoned.matchAll(/enum (\w+) \{([^}]*)\}/g)].map((m) => ({ name: m[1], body: m[2] }));
    const violations: string[] = [];
    for (const { name, body } of enumBlocks) {
      for (const forbidden of ['OVERDUE', 'EXPIRING', 'EXPIRED']) {
        if (!new RegExp(`\\b${forbidden}\\b`).test(body)) continue;
        const exempt = FORBIDDEN_VALUE_EXCEPTIONS.some((e) => e.enumName === name && e.value === forbidden);
        if (!exempt) violations.push(`${name}.${forbidden}`);
      }
    }
    expect(violations).toContain('SubscriptionState.EXPIRED');
  });

  it('regression: an un-exempted, real status enum poisoned with a forbidden value is still caught', () => {
    // Complements the test above from the other direction: an EXISTING
    // `...Status`-named enum (IssueStatus) that is NOT in the exception list
    // must still be caught — proving the exception list is opt-in per
    // (enum, value) pair, not a blanket pass for anything "Status"-shaped.
    const poisoned = schema.replace('enum IssueStatus {\n  ACTIVE', 'enum IssueStatus {\n  OVERDUE\n  ACTIVE');
    expect(poisoned).not.toBe(schema); // the replace actually matched something
    const enumBlocks = [...poisoned.matchAll(/enum (\w+) \{([^}]*)\}/g)].map((m) => ({ name: m[1], body: m[2] }));
    const violations: string[] = [];
    for (const { name, body } of enumBlocks) {
      for (const forbidden of ['OVERDUE', 'EXPIRING', 'EXPIRED']) {
        if (!new RegExp(`\\b${forbidden}\\b`).test(body)) continue;
        const exempt = FORBIDDEN_VALUE_EXCEPTIONS.some((e) => e.enumName === name && e.value === forbidden);
        if (!exempt) violations.push(`${name}.${forbidden}`);
      }
    }
    expect(violations).toContain('IssueStatus.OVERDUE');
  });

  it('keeps Member.externalRef so the Sckools merge needs no migration', () => {
    expect(schema).toMatch(/externalRef\s+String\?/);
  });

  it('keeps LibUser and Member as separate tables', () => {
    expect(schema).toMatch(/^model LibUser \{/m);
    expect(schema).toMatch(/^model Member \{/m);
  });

  /**
   * Permanent guard for the four onDelete: Restrict rules review required
   * (Batch B carry-forward): a live psql reproduction proves nothing ongoing
   * — it never runs in CI — and `onDelete:` is a single keyword with no
   * compiler signal, exactly the shape that silently reverts (e.g. someone
   * regenerating a relation line from a stale draft schema). Restrict here
   * means "deleting the parent while this child row exists must fail
   * loudly", never silently cascade away physical stock or a live financial
   * record. Each entry names the exact relation field line so a change to
   * any one of these four is a one-line, reviewable diff against this file,
   * not a silent schema regression.
   */
  const RESTRICT_RELATIONS: Array<{ model: string; field: string }> = [
    { model: 'Fine', field: 'member' },
    { model: 'Issue', field: 'member' },
    { model: 'Copy', field: 'title' },
    { model: 'Copy', field: 'branch' },
  ];

  function findModelBody(source: string, model: string): string {
    const match = source.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
    if (!match) throw new Error(`model ${model} not found in schema`);
    return match[1];
  }

  it.each(RESTRICT_RELATIONS)('$model.$field is onDelete: Restrict', ({ model, field }) => {
    const body = findModelBody(schema, model);
    const fieldLine = body.split('\n').find((line) => new RegExp(`^\\s*${field}\\s+\\w`).test(line));
    expect(fieldLine).toBeDefined();
    expect(fieldLine).toMatch(/onDelete:\s*Restrict/);
  });

  it('regression: a Restrict relation flipped to Cascade is caught (proves the check discriminates)', () => {
    // Poison ONLY Copy.title's relation line, the same in-memory-string
    // technique the enum guard above uses — never touches the real file.
    const poisoned = schema.replace(
      'title  Title      @relation(fields: [titleId], references: [id], onDelete: Restrict)',
      'title  Title      @relation(fields: [titleId], references: [id], onDelete: Cascade)',
    );
    expect(poisoned).not.toBe(schema); // the replace actually matched something
    const body = findModelBody(poisoned, 'Copy');
    const fieldLine = body.split('\n').find((line) => /^\s*title\s+\w/.test(line));
    expect(fieldLine).toMatch(/onDelete:\s*Cascade/);
    expect(fieldLine).not.toMatch(/onDelete:\s*Restrict/);
  });
});
