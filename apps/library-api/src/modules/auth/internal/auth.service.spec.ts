import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

const ORG = '33333333-3333-4333-8333-333333333333';
const USER = { id: 'u1', orgId: ORG, role: 'LIBRARIAN', branchIds: [], passwordHash: 'HASH', active: true, failedAttempts: 0, lockedUntil: null };

function make(overrides: Partial<{ user: unknown; verify: boolean }> = {}) {
  const recorded: { failures: number; resets: number; verifyCalls: number } = { failures: 0, resets: 0, verifyCalls: 0 };
  const service = new AuthService(
    {
      findByIdentifier: async () => (overrides.user === undefined ? USER : overrides.user),
      recordFailure: async () => { recorded.failures++; },
      recordSuccess: async () => { recorded.resets++; },
    } as never,
    { verify: async () => { recorded.verifyCalls++; return overrides.verify ?? true; } } as never,
    { signAccess: () => 'access', issueRefresh: async () => 'refresh' } as never,
  );
  return { service, recorded };
}

describe('AuthService.login', () => {
  it('issues both tokens for a correct password', async () => {
    const { service, recorded } = make();
    await expect(service.login(ORG, 'a@b.com', 'pw')).resolves.toEqual({
      accessToken: 'access', refreshToken: 'refresh',
    });
    expect(recorded.resets).toBe(1);
  });

  it('gives the same error for an unknown user and a wrong password', async () => {
    const missing = make({ user: null });
    const wrong = make({ verify: false });
    const a = await missing.service.login(ORG, 'nobody@b.com', 'pw').catch((e) => e);
    const b = await wrong.service.login(ORG, 'a@b.com', 'bad').catch((e) => e);
    expect(a).toBeInstanceOf(UnauthorizedException);
    expect(b).toBeInstanceOf(UnauthorizedException);
    expect(a.message).toBe(b.message);
  });

  it('counts a failure so the lockout can engage', async () => {
    const { service, recorded } = make({ verify: false });
    await service.login(ORG, 'a@b.com', 'bad').catch(() => undefined);
    expect(recorded.failures).toBe(1);
  });

  it('refuses a locked account before checking the password', async () => {
    const locked = { ...USER, lockedUntil: new Date(Date.now() + 60_000) };
    const { service } = make({ user: locked, verify: true });
    await expect(service.login(ORG, 'a@b.com', 'pw')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a deactivated account', async () => {
    const { service } = make({ user: { ...USER, active: false } });
    await expect(service.login(ORG, 'a@b.com', 'pw')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Timing-oracle mitigation: an unknown identifier must pay the same argon2
  // cost as a genuine wrong-password check, or an attacker can learn which
  // identifiers exist purely from response latency even though the message
  // is identical. This asserts the real, deterministic signal (the password
  // check ran) rather than wall-clock timing, which would be flaky in CI.
  it('still calls password verification for an unknown user, so there is no timing oracle', async () => {
    const { service, recorded } = make({ user: null });
    await service.login(ORG, 'nobody@b.com', 'pw').catch(() => undefined);
    expect(recorded.verifyCalls).toBe(1);
  });

  it('still calls password verification for a locked account', async () => {
    const locked = { ...USER, lockedUntil: new Date(Date.now() + 60_000) };
    const { service, recorded } = make({ user: locked });
    await service.login(ORG, 'a@b.com', 'pw').catch(() => undefined);
    expect(recorded.verifyCalls).toBe(1);
  });

  it('still calls password verification for a deactivated account', async () => {
    const { service, recorded } = make({ user: { ...USER, active: false } });
    await service.login(ORG, 'a@b.com', 'pw').catch(() => undefined);
    expect(recorded.verifyCalls).toBe(1);
  });
});
