/**
 * Seeds the two orgs the isolation suite and the (future) dashboard need:
 *
 *   raffles   — a realistic single-branch school library: one branch, 300
 *               members, an ORG_OWNER login and a LIBRARIAN login.
 *   northgate — a second org that exists purely so a cross-org isolation
 *               test has something real to fail against. Deliberately thin.
 *
 * Run: `pnpm --filter @library/db seed` (or the root alias `pnpm library:seed`)
 * with LIBRARY_DATABASE_URL_PLATFORM and LIBRARY_SEED_PASSWORD set — e.g.
 *   set -a && source .env && set +a && pnpm library:seed
 *
 * Rerun-safe by construction: orgs/branches/domains/logins are upserted on
 * their unique keys, and the member batch uses `skipDuplicates`, so running
 * this twice updates nothing unexpectedly and creates nothing twice.
 *
 * Uses the BYPASSRLS platform client (`getLibraryPlatformPrisma`), the same
 * one org-console/cron code paths use, because seeding writes rows across
 * two different orgs in one process — RLS would only ever let one org's
 * writes through at a time via `withOrg`.
 */
import * as argon2 from 'argon2';
import { getLibraryPlatformPrisma, disconnectLibrary, type Prisma } from '../src/index';

// Mirrors `apps/library-api/src/modules/auth/internal/password.service.ts`
// exactly (`argon2.hash(plain, { type: argon2.argon2id })`). Not imported
// directly: that file is a NestJS `@Injectable()` in the app layer, and this
// package (`@library/db`) must stay importable by anything — including a
// plain seed script — without pulling in Nest/reflect-metadata. Keep this in
// sync with PasswordService.hash if that algorithm ever changes.
function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan',
  'Krishna', 'Ishaan', 'Ananya', 'Diya', 'Saanvi', 'Aadhya', 'Kiara', 'Myra',
  'Anika', 'Navya', 'Riya', 'Priya', 'Rohan', 'Kabir', 'Aryan', 'Dhruv',
  'Meera', 'Tara', 'Zoya', 'Ira', 'Advait', 'Rehan',
];
const LAST_NAMES = [
  'Sharma', 'Verma', 'Iyer', 'Nair', 'Reddy', 'Gupta', 'Menon', 'Rao',
  'Kumar', 'Singh', 'Patel', 'Chatterjee', 'Mukherjee', 'Pillai', 'Joshi',
  'Kapoor', 'Malhotra', 'Bose', 'Desai', 'Shetty', 'Agarwal', 'Bhat',
  'Chauhan', 'Dutta', 'Krishnan', 'Bhatt', 'Sinha', 'Rana', 'Thakur', 'Naidu',
];

function memberBatch(orgId: string, branchId: string, count: number): Prisma.MemberCreateManyInput[] {
  const rows: Prisma.MemberCreateManyInput[] = [];
  for (let i = 1; i <= count; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length];
    const last = LAST_NAMES[(i * 7) % LAST_NAMES.length]; // different stride so pairs don't cycle in lockstep
    // Roughly 85% students, 10% teachers, 5% external (alumni) — a school
    // library's real membership mix; STUDENT stays the schema default.
    const memberType = i % 20 === 0 ? 'EXTERNAL' : i % 10 === 0 ? 'TEACHER' : 'STUDENT';
    rows.push({
      orgId,
      homeBranchId: branchId,
      code: `LIB-${String(i).padStart(5, '0')}`,
      memberType,
      firstName: first,
      lastName: last,
      status: 'ACTIVE',
    });
  }
  return rows;
}

async function seedRaffles(prisma: ReturnType<typeof getLibraryPlatformPrisma>, seedPassword: string, platformHost: string) {
  const org = await prisma.libraryOrg.upsert({
    where: { slug: 'raffles' },
    update: {},
    create: {
      slug: 'raffles',
      name: 'Raffles International School Library',
      plan: 'PRO',
      status: 'LIVE',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
      contactEmail: 'library@raffles.test',
    },
  });

  await prisma.libraryDomain.upsert({
    where: { hostname: `raffles.${platformHost}` },
    update: {},
    create: { orgId: org.id, hostname: `raffles.${platformHost}`, type: 'SUBDOMAIN', status: 'LIVE' },
  });

  // Single branch for Phase 0a. Reading-room seats (four shifts) are a
  // Phase 2 concept — there is no Seat/Shift model yet, so nothing to seed
  // for them; this comment is the marker for when that model lands.
  const branch = await prisma.branch.upsert({
    where: { orgId_code: { orgId: org.id, code: 'MAIN' } },
    update: {},
    create: { orgId: org.id, name: 'Main Library', code: 'MAIN', active: true },
  });

  const passwordHash = await hashPassword(seedPassword);

  await prisma.libUser.upsert({
    where: { orgId_email: { orgId: org.id, email: 'owner@raffles.test' } },
    update: {},
    create: {
      orgId: org.id,
      email: 'owner@raffles.test',
      passwordHash,
      role: 'ORG_OWNER',
      branchIds: [], // empty = org-wide, per BranchScopeGuard's convention
      active: true,
    },
  });

  await prisma.libUser.upsert({
    where: { orgId_email: { orgId: org.id, email: 'librarian@raffles.test' } },
    update: {},
    create: {
      orgId: org.id,
      email: 'librarian@raffles.test',
      passwordHash,
      role: 'LIBRARIAN',
      branchIds: [branch.id],
      active: true,
    },
  });

  const memberCount = 300;
  const result = await prisma.member.createMany({
    data: memberBatch(org.id, branch.id, memberCount),
    skipDuplicates: true, // rerun-safe: codes LIB-00001..LIB-00300 are stable
  });

  return { org, branch, membersCreated: result.count };
}

async function seedNorthgate(prisma: ReturnType<typeof getLibraryPlatformPrisma>, platformHost: string) {
  // Deliberately thin: this org exists only so the isolation suite (and any
  // manual poking-around) has a second tenant to prove it CANNOT reach.
  const org = await prisma.libraryOrg.upsert({
    where: { slug: 'northgate' },
    update: {},
    create: {
      slug: 'northgate',
      name: 'Northgate Academy Library',
      plan: 'FREE',
      status: 'LIVE',
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
    },
  });

  await prisma.libraryDomain.upsert({
    where: { hostname: `northgate.${platformHost}` },
    update: {},
    create: { orgId: org.id, hostname: `northgate.${platformHost}`, type: 'SUBDOMAIN', status: 'LIVE' },
  });

  const branch = await prisma.branch.upsert({
    where: { orgId_code: { orgId: org.id, code: 'MAIN' } },
    update: {},
    create: { orgId: org.id, name: 'Main Library', code: 'MAIN', active: true },
  });

  const result = await prisma.member.createMany({
    data: memberBatch(org.id, branch.id, 5),
    skipDuplicates: true,
  });

  return { org, branch, membersCreated: result.count };
}

async function main() {
  const seedPassword = process.env.LIBRARY_SEED_PASSWORD;
  if (!seedPassword) {
    throw new Error(
      'LIBRARY_SEED_PASSWORD must be set — the owner/librarian logins are never seeded with a literal password.',
    );
  }
  const platformHost = process.env.LIBRARY_PLATFORM_HOST ?? 'library.trackyour.in';

  const prisma = getLibraryPlatformPrisma();

  const raffles = await seedRaffles(prisma, seedPassword, platformHost);
  const northgate = await seedNorthgate(prisma, platformHost);

  console.log('Seed complete:');
  console.log(
    `  raffles   org=${raffles.org.id} branch=${raffles.branch.id} membersCreated=${raffles.membersCreated}`,
  );
  console.log(
    `  northgate org=${northgate.org.id} branch=${northgate.branch.id} membersCreated=${northgate.membersCreated}`,
  );
  console.log('  logins: owner@raffles.test / librarian@raffles.test (password: $LIBRARY_SEED_PASSWORD)');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectLibrary();
  });
