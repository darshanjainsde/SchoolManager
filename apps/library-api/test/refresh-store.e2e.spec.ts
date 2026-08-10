import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { disconnectLibrary, getLibraryPlatformPrisma } from '@library/db';
import { PrismaRefreshStore } from '../src/modules/auth/internal/auth.module';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * The double-mint race that `RefreshService.rotate` cannot see on its own —
 * two concurrent calls both reading `revokedAt: null` before either write
 * lands — is closed entirely inside `PrismaRefreshStore.markUsed`'s
 * conditional UPDATE. `refresh.service.spec.ts` mocks `markUsed` as
 * `async () => {}`, so it can never exercise that guarantee; it's a
 * property of how Postgres re-evaluates an UPDATE's WHERE clause under
 * concurrent writers, which only real Postgres can prove.
 */
describeLive('PrismaRefreshStore.markUsed is atomic against duplicate consumption', () => {
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const prisma = getLibraryPlatformPrisma();
    const suffix = Date.now().toString(36);
    const org = await prisma.libraryOrg.create({
      data: { slug: `refresh-store-e2e-${suffix}`, name: 'Refresh Store E2E', status: 'LIVE' },
    });
    orgId = org.id;
    const user = await prisma.libUser.create({
      data: {
        orgId,
        email: `refresh-store-e2e-${suffix}@test.local`,
        passwordHash: await argon2.hash('irrelevant', { type: argon2.argon2id }),
        role: 'LIBRARIAN',
        branchIds: [],
        active: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
    await disconnectLibrary();
  });

  it('the first markUsed consumes the row; a second markUsed on the same id is rejected, not silently repeated', async () => {
    const store = new PrismaRefreshStore();
    const row = await getLibraryPlatformPrisma().refreshToken.create({
      data: {
        userId,
        tokenHash: `dup-consume-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        familyId: '55555555-5555-4555-8555-555555555555',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    // First consumption: the row is currently revokedAt: null, so this succeeds.
    await expect(store.markUsed(row.id)).resolves.toBeUndefined();

    // Second consumption of the SAME id: the row is no longer revokedAt: null
    // (the first call already set it), so a correct, atomic implementation
    // must reject this rather than mark it "used" a second time — that second
    // "success" is exactly what would let a race double-mint a child token.
    await expect(store.markUsed(row.id)).rejects.toBeInstanceOf(UnauthorizedException);

    const after = await getLibraryPlatformPrisma().refreshToken.findUnique({ where: { id: row.id } });
    expect(after?.revokedAt).not.toBeNull();
  });
});
