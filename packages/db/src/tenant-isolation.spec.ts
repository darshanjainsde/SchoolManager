/**
 * The boot check that refuses to serve when tenant queries would not be
 * isolated.
 *
 * Written after an audit (4 Sept 2026) found `DATABASE_URL_APP` optional in the
 * config schema and `getTenantPrisma()` falling back to `DATABASE_URL` — on
 * Supabase the `postgres` role, which holds BYPASSRLS. Every `withTenant` call
 * would then run with no isolation at all, and nothing would error: RLS does
 * not complain when it is bypassed, it just returns other schools' rows.
 *
 * The assertion is pure apart from one injected reader, so it is tested here
 * without a database.
 */
import { buildIsolationAssertion } from './tenant-isolation';

describe('assertTenantIsolationEnforced', () => {
  const ok = async () => ({ role: 'skoolos_app', bypassesRls: false });
  const bad = async () => ({ role: 'postgres', bypassesRls: true });

  it('passes silently when the role cannot bypass RLS', async () => {
    const assert = buildIsolationAssertion(ok);
    await expect(assert()).resolves.toBeUndefined();
  });

  it('throws when the role can bypass RLS', async () => {
    const assert = buildIsolationAssertion(bad);
    await expect(assert()).rejects.toThrow(/BYPASSRLS/);
  });

  it('names the offending role and the variable to fix, so the message is actionable', async () => {
    const assert = buildIsolationAssertion(bad);
    await expect(assert()).rejects.toThrow(/postgres/);
    await expect(assert()).rejects.toThrow(/DATABASE_URL_APP/);
  });

  it('only warns outside production, so local dev on one superuser URL still runs', async () => {
    const log = jest.fn();
    const assert = buildIsolationAssertion(bad);
    await expect(assert({ allowBypass: true, log })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('BYPASSRLS'));
  });

  // Asymmetric on purpose. A role that can bypass RLS is a real leak and must
  // stop the process. A database that is briefly unreachable at boot is an
  // infrastructure blip — crashing there would trade a hypothetical leak for a
  // certain outage, so it warns and continues.
  it('does not crash when the database is unreachable at boot', async () => {
    const log = jest.fn();
    const assert = buildIsolationAssertion(async () => { throw new Error('ECONNREFUSED'); });
    await expect(assert({ log })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Could not verify'));
  });

  it('still refuses in production even if the reader is slow to answer', async () => {
    const assert = buildIsolationAssertion(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { role: 'postgres', bypassesRls: true };
    });
    await expect(assert()).rejects.toThrow(/BYPASSRLS/);
  });
});
