import { getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';

export interface SeededOrg { id: string; slug: string; branchId: string; memberId: string }

export const LIVE = Boolean(process.env.LIBRARY_DATABASE_URL_PLATFORM?.includes('postgres'));

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
