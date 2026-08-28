import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `audienceCandidates` is the one place the events module reaches across
 * tenants, and it is on the BYPASSRLS allow-list on the strength of a specific
 * claim: it returns only the public identity of LIVE schools — the same fields
 * the public directory already publishes.
 *
 * The allow-list is only worth something if the claim stays true, so this
 * asserts it rather than trusting the comment.
 */
describe('audience picker cross-tenant read', () => {
  const src = readFileSync(join(__dirname, 'events.service.ts'), 'utf8');
  const fn = src.slice(src.indexOf('async audienceCandidates'), src.indexOf('async create('));

  it('only ever reads LIVE schools', () => {
    expect(fn).toMatch(/status:\s*'LIVE'/);
  });

  it('excludes the calling school from its own picker', () => {
    expect(fn).toMatch(/id:\s*\{\s*not:\s*schoolId\s*\}/);
  });

  it('selects only public identity — never contact details or counts', () => {
    const select = fn.slice(fn.indexOf('select:'), fn.indexOf('orderBy:'));
    expect(select).toContain('name');
    expect(select).toContain('city');
    for (const leaked of ['email', 'phone', 'addressLine', 'students', 'tier', 'geoLat']) {
      expect(select).not.toContain(leaked);
    }
  });

  it('caps the result set rather than returning every school on the platform', () => {
    expect(fn).toMatch(/take:\s*\d+/);
  });
});
