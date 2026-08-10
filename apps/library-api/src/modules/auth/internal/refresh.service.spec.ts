import { UnauthorizedException } from '@nestjs/common';
import { RefreshService } from './refresh.service';

const FAMILY = '44444444-4444-4444-8444-444444444444';

function make(row: unknown) {
  const state = { revokedFamilies: [] as string[], created: 0 };
  const service = new RefreshService(
    {
      findByHash: async () => row,
      create: async () => { state.created++; },
      revokeFamily: async (familyId: string) => { state.revokedFamilies.push(familyId); },
      markUsed: async () => {},
      loadUser: async () => ({ id: 'u1', orgId: 'o1', role: 'LIBRARIAN', branchIds: [] }),
    } as never,
    { signAccess: () => 'access' } as never,
    30,
  );
  return { service, state };
}

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
