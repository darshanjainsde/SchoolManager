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

/**
 * Without this, a freshly seeded library cannot issue a single book: the desk
 * refuses with "No circulation policy configured for member type STUDENT".
 * The API is right to refuse — issuing with no rules is worse than not
 * issuing — but a seed whose whole job is a usable library must supply the
 * rules, and this was found by driving the real desk flow rather than by any
 * test.
 *
 * One row per member type, at the ORG level (branchId null), so a branch can
 * later override a single type without the seed pre-empting that choice.
 * Numbers are ordinary Indian-school defaults, not placeholders: two weeks,
 * one renewal, a rupee a day after three days' grace.
 */
/**
 * A small real shelf.
 *
 * The seed produced 305 members and a lending policy but not one book, so a
 * freshly seeded library had nothing to lend and nothing to search — the
 * catalogue, the desk and every list screen were empty on a working install.
 * Found by driving staging, the same way the missing CirculationPolicy was.
 *
 * Real titles with real ISBNs and Dewey numbers, weighted towards an Indian
 * school library, because a demo full of "Test Book 1" tells you nothing about
 * whether search ranking, spine rendering or call-number sorting actually work.
 */
const SHELF: Array<{
  title: string;
  author: string;
  sortName: string;
  isbn13: string;
  publisher: string;
  year: number;
  dewey: string;
  category: string;
  copies: number;
}> = [
  { title: 'The Hungry Tide', author: 'Amitav Ghosh', sortName: 'Ghosh, Amitav', isbn13: '9780007216147', publisher: 'HarperCollins', year: 2004, dewey: '823.914', category: 'Fiction', copies: 3 },
  { title: 'The Shadow Lines', author: 'Amitav Ghosh', sortName: 'Ghosh, Amitav', isbn13: '9780618329960', publisher: 'Penguin India', year: 1988, dewey: '823.914', category: 'Fiction', copies: 2 },
  { title: 'Midnight’s Children', author: 'Salman Rushdie', sortName: 'Rushdie, Salman', isbn13: '9780099578512', publisher: 'Vintage', year: 1981, dewey: '823.914', category: 'Fiction', copies: 2 },
  { title: 'The God of Small Things', author: 'Arundhati Roy', sortName: 'Roy, Arundhati', isbn13: '9780679457312', publisher: 'Random House', year: 1997, dewey: '823.914', category: 'Fiction', copies: 3 },
  { title: 'Train to Pakistan', author: 'Khushwant Singh', sortName: 'Singh, Khushwant', isbn13: '9780143065883', publisher: 'Penguin India', year: 1956, dewey: '823.912', category: 'Fiction', copies: 2 },
  { title: 'Swami and Friends', author: 'R. K. Narayan', sortName: 'Narayan, R. K.', isbn13: '9780226568355', publisher: 'Indian Thought', year: 1935, dewey: '823.912', category: 'Fiction', copies: 4 },
  { title: 'The Guide', author: 'R. K. Narayan', sortName: 'Narayan, R. K.', isbn13: '9780143039648', publisher: 'Penguin', year: 1958, dewey: '823.912', category: 'Fiction', copies: 2 },
  { title: 'Gitanjali', author: 'Rabindranath Tagore', sortName: 'Tagore, Rabindranath', isbn13: '9780684839349', publisher: 'Scribner', year: 1912, dewey: '891.44', category: 'Poetry', copies: 2 },
  { title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', sortName: 'Kalam, A. P. J. Abdul', isbn13: '9788173711466', publisher: 'Universities Press', year: 1999, dewey: '621.4092', category: 'Biography', copies: 5 },
  { title: 'The Discovery of India', author: 'Jawaharlal Nehru', sortName: 'Nehru, Jawaharlal', isbn13: '9780143031031', publisher: 'Penguin India', year: 1946, dewey: '954', category: 'History', copies: 2 },
  { title: 'India After Gandhi', author: 'Ramachandra Guha', sortName: 'Guha, Ramachandra', isbn13: '9780330396103', publisher: 'Picador', year: 2007, dewey: '954.04', category: 'History', copies: 2 },
  { title: 'A Brief History of Time', author: 'Stephen Hawking', sortName: 'Hawking, Stephen', isbn13: '9780553380163', publisher: 'Bantam', year: 1988, dewey: '523.1', category: 'Science', copies: 3 },
  { title: 'Cosmos', author: 'Carl Sagan', sortName: 'Sagan, Carl', isbn13: '9780345539434', publisher: 'Ballantine', year: 1980, dewey: '520', category: 'Science', copies: 2 },
  { title: 'The Selfish Gene', author: 'Richard Dawkins', sortName: 'Dawkins, Richard', isbn13: '9780198788607', publisher: 'Oxford', year: 1976, dewey: '576.5', category: 'Science', copies: 2 },
  { title: 'Sapiens', author: 'Yuval Noah Harari', sortName: 'Harari, Yuval Noah', isbn13: '9780062316097', publisher: 'Harper', year: 2011, dewey: '909', category: 'History', copies: 3 },
  { title: 'To Kill a Mockingbird', author: 'Harper Lee', sortName: 'Lee, Harper', isbn13: '9780061120084', publisher: 'Harper Perennial', year: 1960, dewey: '813.54', category: 'Fiction', copies: 4 },
  { title: 'Nineteen Eighty-Four', author: 'George Orwell', sortName: 'Orwell, George', isbn13: '9780451524935', publisher: 'Signet', year: 1949, dewey: '823.912', category: 'Fiction', copies: 3 },
  { title: 'Animal Farm', author: 'George Orwell', sortName: 'Orwell, George', isbn13: '9780451526342', publisher: 'Signet', year: 1945, dewey: '823.912', category: 'Fiction', copies: 4 },
  { title: 'The Diary of a Young Girl', author: 'Anne Frank', sortName: 'Frank, Anne', isbn13: '9780553296983', publisher: 'Bantam', year: 1947, dewey: '940.5318', category: 'Biography', copies: 3 },
  { title: 'Harry Potter and the Philosopher’s Stone', author: 'J. K. Rowling', sortName: 'Rowling, J. K.', isbn13: '9780747532699', publisher: 'Bloomsbury', year: 1997, dewey: '823.914', category: 'Children', copies: 6 },
  { title: 'The Hobbit', author: 'J. R. R. Tolkien', sortName: 'Tolkien, J. R. R.', isbn13: '9780547928227', publisher: 'Houghton Mifflin', year: 1937, dewey: '823.912', category: 'Children', copies: 4 },
  { title: 'Panchatantra', author: 'Vishnu Sharma', sortName: 'Sharma, Vishnu', isbn13: '9788175994072', publisher: 'Rupa', year: 1993, dewey: '398.209', category: 'Children', copies: 5 },
  { title: 'Malgudi Days', author: 'R. K. Narayan', sortName: 'Narayan, R. K.', isbn13: '9780143039655', publisher: 'Penguin', year: 1943, dewey: '823.912', category: 'Fiction', copies: 4 },
  { title: 'NCERT Mathematics Class X', author: 'NCERT', sortName: 'NCERT', isbn13: '9788174506542', publisher: 'NCERT', year: 2023, dewey: '510.712', category: 'Textbook', copies: 8 },
];

/**
 * Builds the shelf for one org: categories, authors, titles, and physical
 * copies numbered the way a school actually numbers them.
 *
 * Idempotent by (orgId, isbn13) for titles and (orgId, accessionNumber) for copies, so
 * re-running the seed against an existing database tops it up rather than
 * duplicating it or failing on a unique constraint.
 */
async function seedShelf(
  prisma: ReturnType<typeof getLibraryPlatformPrisma>,
  orgId: string,
  branchId: string,
): Promise<{ titles: number; copies: number }> {
  const categoryIds = new Map<string, string>();
  for (const name of [...new Set(SHELF.map((b) => b.category))]) {
    const existing = await prisma.category.findFirst({ where: { orgId, name }, select: { id: true } });
    const row = existing ?? (await prisma.category.create({ data: { orgId, name }, select: { id: true } }));
    categoryIds.set(name, row.id);
  }

  const authorIds = new Map<string, string>();
  for (const b of SHELF) {
    if (authorIds.has(b.sortName)) continue;
    const existing = await prisma.author.findFirst({ where: { orgId, sortName: b.sortName }, select: { id: true } });
    const row = existing ?? (await prisma.author.create({ data: { orgId, name: b.author, sortName: b.sortName }, select: { id: true } }));
    authorIds.set(b.sortName, row.id);
  }

  let titles = 0;
  let copies = 0;
  let accession = 1001;

  for (const b of SHELF) {
    let title = await prisma.title.findFirst({ where: { orgId, isbn13: b.isbn13 }, select: { id: true } });
    if (!title) {
      title = await prisma.title.create({
        data: {
          orgId,
          title: b.title,
          isbn13: b.isbn13,
          publisher: b.publisher,
          publishedYear: b.year,
          callNumber: b.dewey,
          language: 'en',
        },
        select: { id: true },
      });
      titles += 1;

      await prisma.titleAuthor.create({ data: { titleId: title.id, authorId: authorIds.get(b.sortName)! } });
      await prisma.titleCategory.create({ data: { titleId: title.id, categoryId: categoryIds.get(b.category)! } });
    }

    for (let i = 0; i < b.copies; i += 1) {
      // Plain sequential integers, starting at 1001 — what a school writes by
      // hand inside the front cover. Sequential is load-bearing, not cosmetic:
      // it is what lets stock verification accept a whole shelf as a RANGE
      // (`1001-1040`) instead of forty separate entries.
      const accessionNumber = String(accession++);
      const has = await prisma.copy.findFirst({ where: { orgId, accessionNumber }, select: { id: true } });
      if (has) continue;
      await prisma.copy.create({
        data: { orgId, titleId: title.id, branchId, accessionNumber, shelf: b.dewey.slice(0, 3), condition: 'GOOD' },
      });
      copies += 1;
    }
  }

  return { titles, copies };
}

async function seedCirculationPolicies(
  prisma: ReturnType<typeof getLibraryPlatformPrisma>,
  orgId: string,
): Promise<void> {
  const types = ['STUDENT', 'TEACHER', 'EXTERNAL'] as const;
  const byType = {
    STUDENT: { maxBooks: 3, issueDays: 14, renewLimit: 1, maxReservations: 3 },
    TEACHER: { maxBooks: 10, issueDays: 30, renewLimit: 2, maxReservations: 5 },
    EXTERNAL: { maxBooks: 2, issueDays: 14, renewLimit: 0, maxReservations: 1 },
  } as const;

  for (const memberType of types) {
    const t = byType[memberType];

    // Not an upsert: `CirculationPolicy` has no `@@unique` to key one on. The
    // real rule ("at most one org-default row per (orgId, memberType)") is a
    // partial unique index in SQL, which Prisma cannot express, so there is no
    // compound `where` to upsert against. Find-then-create is safe here because
    // a seed is single-threaded; the partial index is what actually reservations the
    // line against anything concurrent.
    const existing = await prisma.circulationPolicy.findFirst({
      where: { orgId, branchId: null, memberType },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.circulationPolicy.create({
      data: {
        orgId,
        branchId: null,
        memberType,
        maxBooks: t.maxBooks,
        issueDays: t.issueDays,
        renewLimit: t.renewLimit,
        renewDays: t.issueDays,
        finePerDay: 1,
        graceDays: 3,
        maxFine: 100,
        maxReservations: t.maxReservations,
        reservedShelfDays: 5,
        maxOutstandingFine: 50,
      },
    });
  }
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

  await seedCirculationPolicies(prisma, org.id);

  const memberCount = 300;
  const result = await prisma.member.createMany({
    data: memberBatch(org.id, branch.id, memberCount),
    skipDuplicates: true, // rerun-safe: codes LIB-00001..LIB-00300 are stable
  });

  const shelf = await seedShelf(prisma, org.id, branch.id);

  return { org, branch, membersCreated: result.count, ...shelf };
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

  await seedCirculationPolicies(prisma, org.id);

  const result = await prisma.member.createMany({
    data: memberBatch(org.id, branch.id, 5),
    skipDuplicates: true,
  });

  const shelf = await seedShelf(prisma, org.id, branch.id);

  return { org, branch, membersCreated: result.count, ...shelf };
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
    `  raffles   org=${raffles.org.id} branch=${raffles.branch.id} members=${raffles.membersCreated} titles=${raffles.titles} copies=${raffles.copies}`,
  );
  console.log(
    `  northgate org=${northgate.org.id} branch=${northgate.branch.id} members=${northgate.membersCreated} titles=${northgate.titles} copies=${northgate.copies}`,
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
