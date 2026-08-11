import * as argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';
import { signAccessToken } from '../../src/modules/auth/internal/auth.module';
import type { Role } from '../endpoints';

export interface SeededOrg { id: string; slug: string; branchId: string; memberId: string }

export const LIVE = Boolean(process.env.LIBRARY_DATABASE_URL_PLATFORM?.includes('postgres'));

// A skip is fine on a laptop with no docker stack running. In CI it is a
// FALSE GREEN — the suite reports nothing and nobody notices the thing it
// was meant to catch (Task 12 review, finding 2, made this exact mistake
// once already for packages/library-db's RLS audit). So: outside CI, a
// missing/non-postgres LIBRARY_DATABASE_URL_PLATFORM means skip, unchanged.
// Inside CI (`process.env.CI`, set by GitHub Actions and effectively every
// other runner), the same condition throws at import time instead — every
// e2e spec that imports LIVE from here fails loudly rather than silently
// reporting zero tests.
if (!LIVE && process.env.CI) {
  throw new Error(
    'LIBRARY_DATABASE_URL_PLATFORM is not set to a postgres URL while process.env.CI is set. ' +
      'A live-only e2e suite must not silently skip in CI — provision a database for this job ' +
      'and set LIBRARY_DATABASE_URL_PLATFORM, or this file should not be running in this job at all.',
  );
}

/** Two orgs, because a single-tenant seed cannot prove tenant isolation. */
export async function seedTwoOrgs(suffix: string): Promise<{ orgA: SeededOrg; orgB: SeededOrg }> {
  const prisma = getLibraryPlatformPrisma();
  const make = async (slug: string): Promise<SeededOrg> => {
    const org = await prisma.libraryOrg.create({
      data: { slug: `${slug}-${suffix}`, name: slug, status: 'LIVE' },
    });
    const branch = await prisma.branch.create({
      data: { orgId: org.id, name: 'Main', code: 'MAIN' },
    });
    const member = await prisma.member.create({
      data: {
        orgId: org.id, homeBranchId: branch.id, code: 'LIB-00001',
        firstName: 'Test', lastName: slug, status: 'ACTIVE',
      },
    });
    return { id: org.id, slug: org.slug, branchId: branch.id, memberId: member.id };
  };
  return { orgA: await make('alpha'), orgB: await make('bravo') };
}

export async function cleanupOrgs(ids: string[]): Promise<void> {
  const prisma = getLibraryPlatformPrisma();
  await prisma.libraryOrg.deleteMany({ where: { id: { in: ids } } });
  await disconnectLibrary();
}

const ALL_ROLES: Role[] = ['ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER'];

/** Never used to log in over HTTP — only ever hashed and signed directly. */
const SEED_LOGIN_PASSWORD = 'authz-matrix-seed-Pw1!';

/**
 * One `LibUser` per role in `orgId`, and an access token for each — minted
 * with the auth module's own `signAccessToken` (not a reimplementation of
 * JWT signing here), so a token handed to the authz matrix suite is
 * byte-for-byte what a real login would produce. `LibUser` rows are cleaned
 * up automatically by `cleanupOrgs`'s cascading delete on `LibraryOrg`.
 */
export async function seedLogins(orgId: string): Promise<Record<Role, string>> {
  const prisma = getLibraryPlatformPrisma();
  const jwt = new JwtService(); // no Nest DI needed — see lib-jwt.guard.spec.ts for the same standalone pattern
  const passwordHash = await argon2.hash(SEED_LOGIN_PASSWORD, { type: argon2.argon2id });
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const tokens = {} as Record<Role, string>;
  for (const role of ALL_ROLES) {
    const user = await prisma.libUser.create({
      data: {
        orgId,
        email: `${role.toLowerCase()}-${suffix}@matrix.test`,
        passwordHash,
        role,
        branchIds: [],
        active: true,
      },
    });
    tokens[role] = signAccessToken(jwt, {
      id: user.id,
      orgId: user.orgId,
      role: user.role,
      branchIds: user.branchIds,
    });
  }
  return tokens;
}
