import { UnauthorizedException } from '@nestjs/common';
import { RefreshService, type GraceReplayEvent } from './refresh.service';

const FAMILY = '44444444-4444-4444-8444-444444444444';

function make(row: unknown, overrides: { recordGraceReplay?: (event: GraceReplayEvent) => Promise<void> } = {}) {
  const state = { revokedFamilies: [] as string[], created: 0, graceReplays: [] as GraceReplayEvent[] };
  const service = new RefreshService(
    {
      findByHash: async () => row,
      create: async () => { state.created++; },
      revokeFamily: async (familyId: string) => { state.revokedFamilies.push(familyId); },
      markUsed: async () => {},
      loadUser: async () => ({ id: 'u1', orgId: 'o1', role: 'LIBRARIAN', branchIds: [] }),
      recordGraceReplay: overrides.recordGraceReplay
        ?? (async (event: GraceReplayEvent) => { state.graceReplays.push(event); }),
    } as never,
    { signAccess: () => 'access' } as never,
    30,
  );
  return { service, state };
}

describe('RefreshService.rotate — grace window', () => {
  const base = {
    id: 'r1', userId: 'u1', familyId: FAMILY, revokedAt: null,
    expiresAt: new Date(Date.now() + 86_400_000),
    supersededAt: null as Date | null,
  };

  it('replaying a JUST-rotated token mints and returns a FRESH child, not a family revoke', async () => {
    const { service, state } = make({ ...base, revokedAt: new Date(), supersededAt: new Date(Date.now() - 1_000) });
    await expect(service.rotate('raw')).resolves.toMatchObject({ accessToken: 'access' });
    expect(state.revokedFamilies).toEqual([]);
    // A fresh child is minted for the replay (never a stored/reused raw
    // token — see the Finding-1 fix: nothing usable is persisted on this
    // row, so there is nothing to "reuse").
    expect(state.created).toBe(1);
  });

  it('records a grace-replay audit event with ids and elapsed time, never a token or hash', async () => {
    const supersededAt = new Date(Date.now() - 2_000);
    const { service, state } = make({ ...base, revokedAt: new Date(), supersededAt });
    await service.rotate('raw');
    expect(state.graceReplays).toHaveLength(1);
    const event = state.graceReplays[0];
    expect(event).toMatchObject({ userId: 'u1', orgId: 'o1', refreshTokenId: 'r1', familyId: FAMILY });
    expect(event.replayedAfterMs).toBeGreaterThanOrEqual(2_000);
    expect(Object.values(event)).not.toContain('raw');
  });

  it('a grace-replay audit write failure does not block the legitimate reply', async () => {
    const { service } = make(
      { ...base, revokedAt: new Date(), supersededAt: new Date(Date.now() - 1_000) },
      { recordGraceReplay: async () => { throw new Error('audit sink unavailable'); } },
    );
    await expect(service.rotate('raw')).resolves.toMatchObject({ accessToken: 'access' });
  });

  it('replaying a token superseded LONG ago still revokes the family, no audit event', async () => {
    const { service, state } = make({ ...base, revokedAt: new Date(), supersededAt: new Date(Date.now() - 600_000) });
    await expect(service.rotate('raw')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(state.revokedFamilies).toEqual([FAMILY]);
    expect(state.graceReplays).toEqual([]);
  });

  it('a revoked token that was never superseded revokes the family immediately, no audit event', async () => {
    const { service, state } = make({ ...base, revokedAt: new Date() });
    await expect(service.rotate('raw')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(state.revokedFamilies).toEqual([FAMILY]);
    expect(state.graceReplays).toEqual([]);
  });
});

describe('RefreshService.rotate', () => {
  const valid = { id: 'r1', userId: 'u1', familyId: FAMILY, revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000) };

  it('issues a new pair for a live token', async () => {
    const { service, state } = make(valid);
    await expect(service.rotate('raw')).resolves.toMatchObject({ accessToken: 'access' });
    expect(state.created).toBe(1);
  });

  it('revokes the WHOLE family when a revoked token is replayed', async () => {
    const { service, state } = make({ ...valid, revokedAt: new Date() });
    await expect(service.rotate('raw')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(state.revokedFamilies).toEqual([FAMILY]);
  });

  it('rejects an expired token without revoking the family', async () => {
    const { service, state } = make({ ...valid, expiresAt: new Date(Date.now() - 1000) });
    await expect(service.rotate('raw')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(state.revokedFamilies).toEqual([]);
  });

  it('rejects an unknown token', async () => {
    const { service } = make(null);
    await expect(service.rotate('raw')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
