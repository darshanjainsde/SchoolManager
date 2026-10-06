import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every file that writes the outbox must ask for a drain. Until 2026-10-06
 * only two did, and the rest waited for the 02:00 UTC cron — a leave request
 * with Approve/Reject buttons included.
 */
const SRC = join(__dirname, '..', '..');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const sources = walk(SRC).filter((f) => f.endsWith('.ts') && !/\.(e2e-)?spec\.ts$/.test(f));
const writers = sources.filter((f) => /notificationOutbox\.create(Many)?\(/.test(readFileSync(f, 'utf8')));

describe('outbox writers', () => {
  it('finds the writers it guards (a moved file must not silently empty this list)', () => {
    expect(writers.length).toBeGreaterThanOrEqual(14);
  });

  it.each(writers.map((f) => [relative(SRC, f)]))('%s asks for a drain', (rel) => {
    expect(readFileSync(join(SRC, rel), 'utf8')).toMatch(/requestOutboxDrain\(\)/);
  });
});

/**
 * Prisma's `create` returns the whole row, so its INSERT … RETURNING names
 * every column the client knows. Deployed before its migration, a client that
 * knows a new column (expandedAt) fails every notifying write with P2022 — a
 * 500 on posting an exam, recording a fee, applying for leave. `select` limits
 * RETURNING to the columns asked for, so the write survives that window.
 * (`createMany` returns no rows and is safe as it is.)
 */
function outboxCreateArgs(source: string): string[] {
  const needle = 'notificationOutbox.create(';
  const out: string[] = [];
  for (let at = source.indexOf(needle); at !== -1; at = source.indexOf(needle, at + 1)) {
    const start = at + needle.length;
    let depth = 1;
    let quote: string | null = null;
    let i = start;
    for (; i < source.length && depth > 0; i++) {
      const c = source[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"' || c === '`') quote = c;
      else if ('({['.includes(c)) depth++;
      else if (')}]'.includes(c)) depth--;
    }
    out.push(source.slice(start, i - 1));
  }
  return out;
}

describe('outbox create calls', () => {
  const calls = writers.flatMap((f) =>
    outboxCreateArgs(readFileSync(f, 'utf8')).map((arg, n) => [`${relative(SRC, f)} #${n + 1}`, arg] as const),
  );

  it('finds the create calls it guards', () => {
    expect(calls.length).toBeGreaterThanOrEqual(14);
  });

  it.each(calls)('%s carries a select, so deploy-before-migrate cannot 500 it', (_where, arg) => {
    expect(arg).toMatch(/\bselect\s*:\s*\{/);
  });

  it('reads a call without a select as one (the guard can fail)', () => {
    const [arg] = outboxCreateArgs("await tx.notificationOutbox.create({ data: { title: 'a (b)' } });");
    expect(arg).toBe("{ data: { title: 'a (b)' } }");
    expect(arg).not.toMatch(/\bselect\s*:\s*\{/);
  });
});
