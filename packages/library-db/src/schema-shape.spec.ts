import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');

describe('library schema invariants', () => {
  it('generates into its own client directory, never the shared default', () => {
    expect(schema).toMatch(/output\s*=\s*"\.\.\/generated\/client"/);
  });

  it('never stores a time-derived status the way a scheduler would need', () => {
    // OVERDUE / EXPIRING / EXPIRED are computed at read time from dueAt /
    // endDate. Storing them would require a cron to flip them, and Vercel Hobby
    // allows daily crons only — a missed run would then corrupt state.
    for (const forbidden of ['OVERDUE', 'EXPIRING', 'EXPIRED']) {
      expect(schema).not.toContain(`\n  ${forbidden}\n`);
    }
  });

  it('keeps Member.externalRef so the Sckools merge needs no migration', () => {
    expect(schema).toMatch(/externalRef\s+String\?/);
  });

  it('keeps LibUser and Member as separate tables', () => {
    expect(schema).toMatch(/^model LibUser \{/m);
    expect(schema).toMatch(/^model Member \{/m);
  });
});
