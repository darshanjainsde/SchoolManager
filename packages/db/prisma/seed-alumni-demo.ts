/**
 * Demo data for the Homecoming (alumni) wing, for ONE school on a NON-production
 * database.
 *
 * Why this is its own script rather than part of prisma/seed.ts: that seed
 * builds a school from nothing and is meant for an empty database. This one
 * runs against a staging database that is already live and already seeded, so
 * every write here is an upsert keyed on something stable, and it touches
 * nothing outside the alumni tables plus one FeatureOverride row.
 *
 * Re-running it is safe and changes nothing the second time.
 *
 * EVERY table this touches — Alumni, AlumniBatch, AlumniClaim,
 * AlumniLinkRequest, GiftItem, GiftPledge, User, FeatureOverride — carries
 * `tenant_iso` with FORCE ROW LEVEL SECURITY. So the writes go through
 * `withTenant`, which sets `app.current_tenant` for the transaction, rather
 * than through the platform client. Locally the platform role happens to
 * bypass RLS and either would appear to work; on a database where it does not,
 * the platform client silently writes nothing. Not a difference to discover
 * against staging.
 *
 * The point is not volume. It is that every screen in the module has something
 * REAL to show: a verification queue where the match suggestions actually
 * differ from each other, a batch page with a gap in it, a pledge mid-flight,
 * and one alumnus who can genuinely sign in.
 */
/**
 * Connection resolution, done deliberately and in one place.
 *
 * Two traps live here, and this script hit BOTH before it ever reached a real
 * database:
 *
 * 1. `loadEnv()` from @skoolos/config validates the WHOLE application schema —
 *    JWT secrets, hosts, ingress records — and throws if any of it is missing.
 *    A seed needs a database URL and nothing else, so calling it makes the
 *    script unrunnable in CI, where only the database credentials exist.
 *
 * 2. @skoolos/db does not read one variable. `getTenantPrisma()` takes
 *    `DATABASE_URL_APP ?? DATABASE_URL` and `getPlatformPrisma()` takes
 *    `DATABASE_URL_PLATFORM ?? DATABASE_URL`. So on any machine with a root
 *    .env, the MORE SPECIFIC variables win and a `DATABASE_URL=...` passed on
 *    the command line is silently ignored — the run lands on the developer's
 *    own database while reporting success against the one they named.
 *
 * So: ONE variable decides, and it is pinned onto all three before any client
 * is constructed. A .env can supply it when nothing else does; it can never
 * redirect it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function dotenvValue(key: string): string | undefined {
  const path = resolve(__dirname, '../../../.env');
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}

const DB_URL = process.env.DATABASE_URL ?? dotenvValue('DATABASE_URL');
if (!DB_URL) throw new Error('DATABASE_URL must be set (in the environment, or in a root .env).');
// Pin all three, so which client is used cannot change where the writes land.
process.env.DATABASE_URL = DB_URL;
process.env.DATABASE_URL_APP = DB_URL;
process.env.DATABASE_URL_PLATFORM = DB_URL;

import { getPlatformPrisma, withTenant, disconnectAll } from '@skoolos/db';
import { hash } from 'argon2';

const SLUG = process.env.DEMO_SCHOOL_SLUG ?? 'beacon';
/** Staging only, and printed at the end so it can be handed over. */
const ALUMNUS_PW = process.env.DEMO_ALUMNUS_PASSWORD ?? 'Alumni@2026';

/** Resolve the school and print what WOULD be written, then stop. The same
 *  idea as db-migrate's inspect_only: the first run against a live database
 *  should not be the first run of the script. */
const DRY_RUN = process.env.DEMO_DRY_RUN === 'true';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Three privacy postures, because one is not a demonstration.
 *
 * The default (`defaultPrivacy()`) hides a name from PUBLIC, which is right —
 * but a roll where EVERY row is private renders a batch page of twelve
 * identical "A former student" entries, and that reads as a broken page rather
 * than as a working privacy rule. It also hides the thing the public page
 * exists for: somebody who left in 1998 finding themselves from a search
 * engine.
 *
 * So the demo carries the real spread a school would actually have.
 */
/** Opened up: findable from outside, which is how recovery works at all. */
const PUBLIC = { name: 'PUBLIC', photo: 'PUBLIC', city: 'PUBLIC', work: 'PUBLIC', college: 'PUBLIC', phone: 'BATCH' };
/** The common posture: visible to fellow alumni, invisible to the internet. */
const OPEN = { name: 'ALUMNI', photo: 'ALUMNI', city: 'ALUMNI', work: 'ALUMNI', college: 'ALUMNI', phone: 'BATCH' };
/** Listed, and almost nothing else. Every module needs one of these to prove
 *  that opting out is real. */
const SHY = { name: 'ALUMNI', photo: 'HIDDEN', city: 'HIDDEN', work: 'HIDDEN', college: 'HIDDEN', phone: 'HIDDEN' };

type Person = {
  firstName: string; lastName: string; batchYear: number; dob: string;
  guardianName: string; lastClass: string; admissionNo: string;
  city?: string; country?: string; profession?: string; employer?: string;
  collegeName?: string; email?: string; phone?: string;
  trusted?: boolean; captain?: boolean; mentor?: boolean; shy?: boolean; open?: boolean;
};

const PEOPLE: Person[] = [
  // ── 1998: the batch that predates the software entirely ──────────────────
  { open: true, firstName: 'Farida', lastName: 'Sheikh', batchYear: 1998, dob: '1980-04-12', guardianName: 'Iqbal Sheikh',
    lastClass: '12-A', admissionNo: 'B/1994/031', city: 'Pune', country: 'India',
    profession: 'Paediatrician', employer: 'Sahyadri Hospital', collegeName: 'B.J. Medical College',
    email: 'farida.sheikh@example.com', phone: '+91 98123 45678', captain: true, trusted: true },
  { firstName: 'Anil', lastName: 'Deshpande', batchYear: 1998, dob: '1980-09-02', guardianName: 'M. R. Deshpande',
    lastClass: '12-B', admissionNo: 'B/1994/044', city: 'Dubai', country: 'UAE',
    profession: 'Site engineer', employer: 'Al Naboodah', collegeName: 'COEP' },
  { firstName: 'Sunita', lastName: 'Rao', batchYear: 1998, dob: '1980-11-19', guardianName: 'K. Rao',
    lastClass: '12-A', admissionNo: 'B/1994/052', city: 'Bengaluru', country: 'India',
    profession: 'School principal', employer: 'Vidya Niketan', shy: true },

  // ── 2004 ─────────────────────────────────────────────────────────────────
  { open: true, firstName: 'Vikram', lastName: 'Chauhan', batchYear: 2004, dob: '1986-06-30', guardianName: 'R. S. Chauhan',
    lastClass: '12-C', admissionNo: 'B/2000/018', city: 'Mumbai', country: 'India',
    profession: 'Chartered accountant', employer: 'Deloitte', collegeName: 'Sydenham',
    email: 'vikram.chauhan@example.com', mentor: true, trusted: true },
  { firstName: 'Meera', lastName: 'Pillai', batchYear: 2004, dob: '1986-02-14', guardianName: 'G. Pillai',
    lastClass: '12-A', admissionNo: 'B/2000/007', city: 'Kochi', country: 'India',
    profession: 'Marine biologist', employer: 'CMFRI', collegeName: 'CUSAT', mentor: true },
  { firstName: 'Rohit', lastName: 'Nair', batchYear: 2004, dob: '1986-08-08', guardianName: 'P. Nair',
    lastClass: '12-B', admissionNo: 'B/2000/029', city: 'Toronto', country: 'Canada',
    profession: 'Product designer', employer: 'Shopify' },

  // ── 2011 ─────────────────────────────────────────────────────────────────
  { open: true, firstName: 'Aisha', lastName: 'Qureshi', batchYear: 2011, dob: '1993-03-21', guardianName: 'N. Qureshi',
    lastClass: '12-A', admissionNo: 'B/2007/011', city: 'Hyderabad', country: 'India',
    profession: 'Civil services', employer: 'Govt. of Telangana', collegeName: 'NALSAR', trusted: true },
  { firstName: 'Karan', lastName: 'Mehta', batchYear: 2011, dob: '1993-07-05', guardianName: 'D. Mehta',
    lastClass: '12-C', admissionNo: 'B/2007/026', city: 'Ahmedabad', country: 'India',
    profession: 'Founder', employer: 'Kite Logistics' },
  { firstName: 'Priya', lastName: 'Iyer', batchYear: 2011, dob: '1993-12-01', guardianName: 'S. Iyer',
    lastClass: '12-B', admissionNo: 'B/2007/033', city: 'Chennai', country: 'India',
    profession: 'Architect', employer: 'Self-employed', shy: true },

  // ── 2018: recent enough that the school still has phone numbers ──────────
  { firstName: 'Zoya', lastName: 'Ansari', batchYear: 2018, dob: '2000-05-17', guardianName: 'F. Ansari',
    lastClass: '12-A', admissionNo: 'B/2014/009', city: 'Pune', country: 'India',
    profession: 'Junior doctor', employer: 'KEM Hospital', collegeName: 'AFMC',
    phone: '+91 90000 11122', trusted: true },
  { firstName: 'Aditya', lastName: 'Kulkarni', batchYear: 2018, dob: '2000-01-23', guardianName: 'V. Kulkarni',
    lastClass: '12-B', admissionNo: 'B/2014/021', city: 'Berlin', country: 'Germany',
    profession: 'Research assistant', employer: 'TU Berlin', collegeName: 'IIT Bombay' },
  { open: true, firstName: 'Neha', lastName: 'Bhosale', batchYear: 2018, dob: '2000-10-09', guardianName: 'A. Bhosale',
    lastClass: '12-A', admissionNo: 'B/2014/014', city: 'Pune', country: 'India',
    profession: 'Journalist', employer: 'Indian Express', captain: true },
];

/** Who gets the ordinary email + password login, so the alumnus half can be
 *  signed into and driven the way a real one would. Trusted, so the sessions
 *  half is reachable too. */
const LOGIN_FOR = { firstName: 'Vikram', lastName: 'Chauhan', email: 'vikram.chauhan@example.com' };

async function main() {
  // School itself is platform-scoped, so the lookup goes through the platform
  // client; everything after it is tenant-scoped and goes through withTenant.
  const platform = getPlatformPrisma();

  const school = await platform.school.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!school) throw new Error(`No school with slug "${SLUG}" on this database.`);
  const schoolId = school.id;
  console.log(`→ ${school.name} (${SLUG})`);

  if (DRY_RUN) {
    // Prove the connection before believing anything it says — DATABASE_URL
    // alone does not redirect this codebase's clients, so "which database am I
    // actually on" is a fact to check, not to assume.
    const where = await platform.$queryRawUnsafe<{ db: string; usr: string }[]>(
      'select current_database() as db, current_user as usr',
    );
    console.log(`  connected to: ${where[0]?.db} as ${where[0]?.usr}`);
    const existing = await platform.alumni.count({ where: { schoolId } }).catch(() => -1);
    console.log('  DRY RUN — nothing will be written. This run would:');
    console.log('    · enable the ALUMNI feature override');
    console.log(`    · upsert ${PEOPLE.length} alumni (school currently holds ${existing})`);
    console.log('    · set register strength for 4 batches');
    console.log(`    · give ${LOGIN_FOR.email} an ALUMNUS login`);
    console.log('    · add 3 pending claims, 1 link request, 4 gift items, 2 pledges');
    return;
  }

  // Hash before any transaction — argon2 is deliberately slow, and a
  // transaction held open across it is a transaction held open for no reason.
  const passwordHash = await hash(ALUMNUS_PW);

  /**
   * Each section gets its OWN short transaction.
   *
   * The first version wrapped the whole seed in one `withTenant`, which
   * passed locally against a database on localhost and died against staging
   * with P2028: Prisma's interactive transactions have a five-second ceiling,
   * and this is dozens of round-trips to ap-south-1 from a GitHub runner.
   *
   * The fix is not a longer timeout — `withTenant` is the whole application's
   * and holding a pooled connection open for a minute is exactly what should
   * not be encouraged. It is smaller transactions, which is the right shape
   * for a seed anyway. Losing all-or-nothing costs nothing here: every write
   * is an upsert, so a partial run is simply re-run.
   */
  const step = <T>(fn: (db: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
    withTenant(schoolId, fn);

  await step(async (db) => {
  // ── The feature itself ───────────────────────────────────────────────────
  // ALUMNI belongs to no tier by design, so without this row every route 403s
  // and every screen is a 404. Cached in Redis for 300s after this lands.
  const existingFlag = await db.featureOverride.findFirst({ where: { schoolId, featureKey: 'ALUMNI' } });
  if (existingFlag) {
    await db.featureOverride.update({ where: { id: existingFlag.id }, data: { enabled: true } });
  } else {
    await db.featureOverride.create({ data: { schoolId, featureKey: 'ALUMNI', enabled: true } });
  }
  });
  console.log('  ✓ ALUMNI feature enabled');

  // ── The roll ─────────────────────────────────────────────────────────────
  // One person per transaction: twelve short writes beat one long one, and a
  // seed's wall-clock is worth nothing next to it actually finishing.
  const byName = new Map<string, string>();
  for (const p of PEOPLE) {
    await step(async (db) => {
    const key = `${p.firstName} ${p.lastName}`;
    const found = await db.alumni.findFirst({
      where: { schoolId, firstName: p.firstName, lastName: p.lastName, batchYear: p.batchYear },
      select: { id: true },
    });
    const data = {
      schoolId,
      firstName: p.firstName, lastName: p.lastName, batchYear: p.batchYear,
      dob: d(p.dob), guardianName: p.guardianName,
      lastClass: p.lastClass, admissionNo: p.admissionNo,
      city: p.city ?? null, country: p.country ?? null,
      profession: p.profession ?? null, employer: p.employer ?? null,
      collegeName: p.collegeName ?? null,
      email: p.email ?? null, phone: p.phone ?? null,
      status: 'VERIFIED' as const,
      trustedForStudents: !!p.trusted,
      isBatchCaptain: !!p.captain,
      isMentor: !!p.mentor,
      privacy: p.shy ? SHY : p.open ? PUBLIC : OPEN,
      verifiedAt: new Date(),
    };
    const row = found
      ? await db.alumni.update({ where: { id: found.id }, data, select: { id: true } })
      : await db.alumni.create({ data, select: { id: true } });
    byName.set(key, row.id);
    });
  }
  console.log(`  ✓ ${PEOPLE.length} alumni on the roll`);

  // ── Register strength, so Roll Call has a denominator and a real gap ─────
  // Deliberately larger than what is on the roll: the coverage bar is the
  // module's honest statement of how much of a batch is still missing.
  for (const [batchYear, registerStrength] of [[1998, 96], [2004, 104], [2011, 112], [2018, 118]] as const) {
    await step((db) => db.alumniBatch.upsert({
      where: { schoolId_batchYear: { schoolId, batchYear } },
      update: { registerStrength },
      create: { schoolId, batchYear, registerStrength },
    }));
  }
  console.log('  ✓ register strength for 4 batches');

  // ── The login ────────────────────────────────────────────────────────────
  const loginAlumniId = byName.get(`${LOGIN_FOR.firstName} ${LOGIN_FOR.lastName}`)!;
  await step(async (db) => {
    const existingUser = await db.user.findFirst({ where: { schoolId, email: LOGIN_FOR.email } });
    const user = existingUser
      ? await db.user.update({ where: { id: existingUser.id }, data: { passwordHash, role: 'ALUMNUS' } })
      : await db.user.create({ data: { schoolId, email: LOGIN_FOR.email, passwordHash, role: 'ALUMNUS' } });
    await db.alumni.update({ where: { id: loginAlumniId }, data: { userId: user.id, email: LOGIN_FOR.email } });
  });
  console.log(`  ✓ login for ${LOGIN_FOR.firstName}: ${LOGIN_FOR.email}`);

  // ── The verification queue ───────────────────────────────────────────────
  // Built so the three match strengths are visibly DIFFERENT from each other,
  // because a shortlist that says the same thing about every row teaches the
  // office nothing.
  const CLAIMS = [
    {
      // STRONG: name + year + date of birth all line up with Sunita Rao.
      firstName: 'Sunita', lastName: 'Rao', batchYear: 1998, claimedDob: d('1980-11-19'),
      claimedClass: '12-A', claimedAdmissionNo: null,
      email: 'sunita.rao.work@example.com', phone: '+91 99887 76655',
      proof: 'Our class teacher was Mrs. Dandekar. I am in the 1998 farewell photo, third row.',
    },
    {
      // WEAK: married name, so only the date of birth matches Priya Iyer.
      firstName: 'Priya', lastName: 'Raghunathan', batchYear: 2011, claimedDob: d('1993-12-01'),
      claimedClass: null, claimedAdmissionNo: null,
      email: 'priya.r@example.com', phone: null,
      proof: 'I was Priya Iyer before marriage. Cannot remember my section — 12-B or 12-C.',
    },
    {
      // NO MATCH: nobody of that name or date of birth left in 2004.
      firstName: 'Sameer', lastName: 'Joshi', batchYear: 2004, claimedDob: d('1986-04-04'),
      claimedClass: '12-B', claimedAdmissionNo: 'B/2000/0??',
      email: 'sameer.joshi@example.com', phone: '+91 98765 43210',
      proof: 'I left after the half-yearly in class 12 and finished elsewhere. Ravi Kadam can vouch.',
    },
  ];
  for (const c of CLAIMS) {
    await step(async (db) => {
      const already = await db.alumniClaim.findFirst({
        where: { schoolId, firstName: c.firstName, lastName: c.lastName, batchYear: c.batchYear },
        select: { id: true },
      });
      if (!already) await db.alumniClaim.create({ data: { schoolId, ...c, status: 'PENDING' } });
    });
  }
  console.log(`  ✓ ${CLAIMS.length} claims waiting, with three different match strengths`);

  // ── "Send me my link" queue ──────────────────────────────────────────────
  const linkFor = byName.get('Farida Sheikh')!;
  await step(async (db) => {
    const openReq = await db.alumniLinkRequest.findFirst({ where: { schoolId, alumniId: linkFor, status: 'PENDING' } });
    if (!openReq) await db.alumniLinkRequest.create({ data: { schoolId, alumniId: linkFor, status: 'PENDING' } });
  });
  console.log('  ✓ 1 link request waiting');

  // ── What the school actually wants ───────────────────────────────────────
  const ITEMS = [
    { name: 'Winter sweater', unit: 'per child', indicativeCostMinor: 45000, sizesTracked: true, order: 1 },
    { name: 'Notebook set (6)', unit: 'per child', indicativeCostMinor: 18000, sizesTracked: false, order: 2 },
    { name: 'School shoes', unit: 'per child', indicativeCostMinor: 62000, sizesTracked: true, order: 3 },
    { name: 'Library book fund', unit: 'per class', indicativeCostMinor: 500000, sizesTracked: false, order: 4 },
  ];
  const itemIds = new Map<string, string>();
  for (const it of ITEMS) {
    const row = await step((db) => db.giftItem.upsert({
      where: { schoolId_name: { schoolId, name: it.name } },
      update: { ...it, schoolId, isActive: true },
      create: { ...it, schoolId, isActive: true },
      select: { id: true },
    }));
    itemIds.set(it.name, row.id);
  }
  console.log(`  ✓ ${ITEMS.length} gift items published`);

  // ── Two pledges, at different points in the flow ─────────────────────────
  // The real live headcount, which is what a pledge's quantity IS — a gift
  // covers everyone in the group or it waits. Falls back only on a school with
  // no students loaded yet, so the demo still has a number to show.
  const headcount = await step((db) => db.student.count({ where: { schoolId, isActive: true } }));
  const scopeCount = headcount > 0 ? headcount : 240;
  if (headcount < 20) {
    // Not fatal, but say it plainly. A gift's quantity IS the live headcount,
    // so an empty school produces pledges for one child and gifting screens
    // that look broken while being perfectly correct — which cost real time to
    // diagnose the first time it happened.
    console.log(
      `  ! only ${headcount} active students here — gift screens will look thin.`
      + ' Run seed-school-demo.ts against this school first.',
    );
  }
  console.log(`  · live headcount: ${headcount || '(none — using 240 for the demo)'}`);
  // Five pledges, placed at DIFFERENT points on the two journeys — because the
  // whole feature is the journey, and a demo where everything sits at PROPOSED
  // shows none of it. Vikram gets three of them so the signed-in donor has a
  // history worth opening.
  const vikram = byName.get('Vikram Chauhan')!;
  const PLEDGES = [
    {
      alumniId: byName.get('Farida Sheikh')!, giftItemId: itemIds.get('Winter sweater')!,
      scopeKind: 'SCHOOL' as const, headcountAtPledge: scopeCount, quantity: scopeCount,
      mode: 'SUPPLY' as const, amountMinor: null,
      dedicationKind: 'IN_MEMORY_OF' as const, dedicationText: 'In memory of Mrs. Dandekar',
      visibility: 'PUBLIC' as const, status: 'PROPOSED' as const,
    },
    {
      alumniId: byName.get('Karan Mehta')!, giftItemId: itemIds.get('Notebook set (6)')!,
      scopeKind: 'SCHOOL' as const, headcountAtPledge: scopeCount, quantity: scopeCount,
      mode: 'FUND' as const, amountMinor: 18000 * scopeCount, unitPriceMinor: 18000,
      dedicationKind: 'NONE' as const, dedicationText: null,
      visibility: 'ALUMNI' as const, status: 'ACCEPTED' as const,
    },
    // Goods, mid-flight: collected and on a courier, so the donor's screen has
    // a tracking number to show and the office has an arrival to confirm.
    {
      alumniId: vikram, giftItemId: itemIds.get('School shoes')!,
      scopeKind: 'SCHOOL' as const, headcountAtPledge: scopeCount, quantity: scopeCount,
      mode: 'SUPPLY' as const, amountMinor: null,
      dedicationKind: 'NONE' as const, dedicationText: null,
      visibility: 'ALUMNI' as const, status: 'PICKED_UP' as const,
      pickupAddress: '14 Residency Road, Pune 411001',
      pickupContact: 'Building watchman',
      pickupPhone: '+91 98120 00011',
      pickupNote: 'Four cartons, second floor, no lift.',
      pickupRequestedAt: new Date(),
      courier: 'Delhivery',
      trackingRef: 'DL-4471902',
      pickedUpAt: new Date(),
    },
    // Money, spent but not yet handed out.
    {
      alumniId: vikram, giftItemId: itemIds.get('Library book fund')!,
      scopeKind: 'SCHOOL' as const, headcountAtPledge: scopeCount, quantity: scopeCount,
      mode: 'FUND' as const, amountMinor: 500000 * scopeCount, unitPriceMinor: 500000,
      dedicationKind: 'IN_HONOUR_OF' as const, dedicationText: 'In honour of the class of 2004',
      visibility: 'ALUMNI' as const, status: 'PURCHASED' as const,
      purchasedAt: new Date(),
    },
    // Finished, with the school's own words back — the state the whole feature
    // exists to reach.
    {
      alumniId: vikram, giftItemId: null,
      customRequest: 'Sports kit for the under-14 team',
      scopeKind: 'SCHOOL' as const, headcountAtPledge: scopeCount, quantity: scopeCount,
      mode: 'SUPPLY' as const, amountMinor: null,
      dedicationKind: 'NONE' as const, dedicationText: null,
      visibility: 'ALUMNI' as const, status: 'DISTRIBUTED' as const,
      thankYouNote:
        'They wore the new kit for the inter-house final on Saturday and won it. '
        + 'Thank you — the old set had been patched twice and the children knew it.',
      thankYouAt: new Date(),
    },
  ];
  for (const p of PLEDGES) {
    await step(async (db) => {
      const already = await db.giftPledge.findFirst({
        where: {
          schoolId,
          alumniId: p.alumniId,
          ...(p.giftItemId ? { giftItemId: p.giftItemId } : { customRequest: p.customRequest }),
        },
        select: { id: true },
      });
      if (already) return;
      const created = await db.giftPledge.create({ data: { schoolId, ...p } });

      // A pledge past PROPOSED with an empty history is exactly the screen this
      // feature was built to replace, so the demo carries the journey too.
      const walked: Record<string, string[]> = {
        ACCEPTED: ['ACCEPTED'],
        PICKED_UP: ['ACCEPTED', 'PICKUP_REQUESTED', 'PICKED_UP'],
        PURCHASED: ['ACCEPTED', 'RECEIVED', 'PURCHASED'],
        DISTRIBUTED: ['ACCEPTED', 'RECEIVED', 'DISTRIBUTED'],
      };
      const steps = walked[p.status] ?? [];
      const notes: Record<string, string> = {
        ACCEPTED: 'The office accepted this.',
        PICKUP_REQUESTED: 'Collection arranged from 14 Residency Road, Pune.',
        PICKED_UP: 'Collected by Delhivery — DL-4471902.',
        RECEIVED: p.mode === 'FUND' ? 'The funds landed.' : 'Arrived at the school.',
        PURCHASED: 'Bought by the school.',
        DISTRIBUTED: `Given to ${scopeCount} children.`,
      };
      for (const [i, status] of steps.entries()) {
        await db.giftEvent.create({
          data: {
            schoolId,
            pledgeId: created.id,
            status: status as never,
            note: notes[status] ?? null,
            // Spread backwards through the last fortnight so the timeline reads
            // as a sequence rather than as one instant.
            at: new Date(Date.now() - (steps.length - i) * 3 * 24 * 3600 * 1000),
          },
        });
      }
      // The two that are in hand also need a receipt, or the shortfall rule
      // reports them as still owed and the office cannot hand them out.
      if (p.status === 'PURCHASED' || p.status === 'DISTRIBUTED') {
        await db.giftReceipt.create({
          data: { schoolId, pledgeId: created.id, receivedQty: p.quantity },
        });
      }
      if (p.status === 'DISTRIBUTED') {
        await db.giftDistribution.create({
          data: { schoolId, pledgeId: created.id, distributedQty: p.quantity, absentQty: 0 },
        });
      }
    });
  }
  console.log(`  ✓ ${PLEDGES.length} pledges, spread across both journeys`);

  // Pledges left behind by API testing: PROPOSED, no history, no dedication.
  // On screen they are indistinguishable from real demo data and they make the
  // office queue look like a mess.
  //
  // Safe to identify precisely, rather than by counting: the seed's OWN
  // proposed pledge carries a dedication ("In memory of Mrs. Dandekar"), and a
  // pledge somebody has actually decided on has events. So "proposed, no
  // events, no dedication" is exactly the litter and nothing else.
  const cleared = await step((db) => db.giftPledge.deleteMany({
    where: { schoolId, status: 'PROPOSED', dedicationText: null, events: { none: {} } },
  }));
  if (cleared.count > 0) console.log(`  ✓ cleared ${cleared.count} stray test pledges`);

  console.log('\n──────────────────────────────────────────────');
  console.log('  Alumnus login');
  console.log(`    ${LOGIN_FOR.email}`);
  console.log(`    ${ALUMNUS_PW}`);
  console.log('  Cleared for student sessions, so the Sessions tab is reachable.');
  console.log('──────────────────────────────────────────────');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => disconnectAll());
