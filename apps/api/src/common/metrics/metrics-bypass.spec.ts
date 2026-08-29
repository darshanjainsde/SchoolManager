import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * metrics.service is on the BYPASSRLS allow-list on the strength of a specific
 * claim: it touches only MetricRollup, which holds route names and numbers and
 * has no schoolId. An allow-list entry is only worth something while its
 * justification stays true, so this asserts it rather than trusting the comment.
 */
describe('metrics cross-tenant write', () => {
  const src = readFileSync(join(__dirname, 'metrics.service.ts'), 'utf8');

  it('reaches only the MetricRollup table', () => {
    const models = [...src.matchAll(/\bdb\.(\w+)\./g)].map((m) => m[1]);
    expect(new Set(models)).toEqual(new Set(['metricRollup']));
  });

  it('never reads a tenant table', () => {
    for (const tenant of ['student', 'teacher', 'attendance', 'user', 'school.']) {
      expect(src).not.toContain(`db.${tenant}`);
    }
  });
});
