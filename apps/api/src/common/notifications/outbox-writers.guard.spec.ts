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
