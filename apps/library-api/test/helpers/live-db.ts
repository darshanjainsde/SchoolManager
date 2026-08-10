import { getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';

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
