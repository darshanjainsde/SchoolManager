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
import { loadEnv } from '@skoolos/config';
loadEnv();
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

/** Open enough to be worth looking at, without inventing a contact detail the
 *  person never published — which is the module's whole rule. */
const OPEN = { name: 'ALUMNI', photo: 'ALUMNI', city: 'ALUMNI', work: 'ALUMNI', college: 'ALUMNI', phone: 'BATCH' };
const SHY = { name: 'ALUMNI', photo: 'HIDDEN', city: 'ALUMNI', work: 'ALUMNI', college: 'HIDDEN', phone: 'HIDDEN' };

type Person = {
  firstName: string; lastName: string; batchYear: number; dob: string;
  guardianName: string; lastClass: string; admissionNo: string;
  city?: string; country?: string; profession?: string; employer?: string;
  collegeName?: string; email?: string; phone?: string;
  trusted?: boolean; captain?: boolean; mentor?: boolean; shy?: boolean;
};

const PEOPLE: Person[] = [
  // ── 1998: the batch that predates the software entirely ──────────────────
  { firstName: 'Farida', lastName: 'Sheikh', batchYear: 1998, dob: '1980-04-12', guardianName: 'Iqbal Sheikh',
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
  { firstName: 'Vikram', lastName: 'Chauhan', batchYear: 2004, dob: '1986-06-30', guardianName: 'R. S. Chauhan',
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
  { firstName: 'Aisha', lastName: 'Qureshi', batchYear: 2011, dob: '1993-03-21', guardianName: 'N. Qureshi',
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
  { firstName: 'Neha', lastName: 'Bhosale', batchYear: 2018, dob: '2000-10-09', guardianName: 'A. Bhosale',
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

  // Hash before opening the transaction — argon2 is deliberately slow, and a
  // transaction held open across it is a transaction held open for no reason.
  const passwordHash = await hash(ALUMNUS_PW);

  await withTenant(schoolId, async (db) => {
  // ── The feature itself ───────────────────────────────────────────────────
  // ALUMNI belongs to no tier by design, so without this row every route 403s
  // and every screen is a 404. Cached in Redis for 300s after this lands.
  const existingFlag = await db.featureOverride.findFirst({ where: { schoolId, featureKey: 'ALUMNI' } });
  if (existingFlag) {
    await db.featureOverride.update({ where: { id: existingFlag.id }, data: { enabled: true } });
  } else {
    await db.featureOverride.create({ data: { schoolId, featureKey: 'ALUMNI', enabled: true } });
  }
  console.log('  ✓ ALUMNI feature enabled');

  // ── The roll ─────────────────────────────────────────────────────────────
  const byName = new Map<string, string>();
  for (const p of PEOPLE) {
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
      privacy: p.shy ? SHY : OPEN,
      verifiedAt: new Date(),
    };
    const row = found
      ? await db.alumni.update({ where: { id: found.id }, data, select: { id: true } })
      : await db.alumni.create({ data, select: { id: true } });
    byName.set(key, row.id);
  }
  console.log(`  ✓ ${PEOPLE.length} alumni on the roll`);

  // ── Register strength, so Roll Call has a denominator and a real gap ─────
  // Deliberately larger than what is on the roll: the coverage bar is the
  // module's honest statement of how much of a batch is still missing.
  for (const [batchYear, registerStrength] of [[1998, 96], [2004, 104], [2011, 112], [2018, 118]] as const) {
    await db.alumniBatch.upsert({
      where: { schoolId_batchYear: { schoolId, batchYear } },
      update: { registerStrength },
      create: { schoolId, batchYear, registerStrength },
    });
  }
  console.log('  ✓ register strength for 4 batches');

  // ── The login ────────────────────────────────────────────────────────────
  const loginAlumniId = byName.get(`${LOGIN_FOR.firstName} ${LOGIN_FOR.lastName}`)!;
  const existingUser = await db.user.findFirst({ where: { schoolId, email: LOGIN_FOR.email } });
  const user = existingUser
    ? await db.user.update({ where: { id: existingUser.id }, data: { passwordHash, role: 'ALUMNUS' } })
    : await db.user.create({ data: { schoolId, email: LOGIN_FOR.email, passwordHash, role: 'ALUMNUS' } });
  await db.alumni.update({ where: { id: loginAlumniId }, data: { userId: user.id, email: LOGIN_FOR.email } });
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
    const already = await db.alumniClaim.findFirst({
      where: { schoolId, firstName: c.firstName, lastName: c.lastName, batchYear: c.batchYear },
      select: { id: true },
    });
    if (!already) await db.alumniClaim.create({ data: { schoolId, ...c, status: 'PENDING' } });
  }
  console.log(`  ✓ ${CLAIMS.length} claims waiting, with three different match strengths`);

  // ── "Send me my link" queue ──────────────────────────────────────────────
  const linkFor = byName.get('Farida Sheikh')!;
  const openReq = await db.alumniLinkRequest.findFirst({ where: { schoolId, alumniId: linkFor, status: 'PENDING' } });
  if (!openReq) await db.alumniLinkRequest.create({ data: { schoolId, alumniId: linkFor, status: 'PENDING' } });
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
    const row = await db.giftItem.upsert({
      where: { schoolId_name: { schoolId, name: it.name } },
      update: { ...it, schoolId, isActive: true },
      create: { ...it, schoolId, isActive: true },
      select: { id: true },
    });
    itemIds.set(it.name, row.id);
  }
  console.log(`  ✓ ${ITEMS.length} gift items published`);

  // ── Two pledges, at different points in the flow ─────────────────────────
  // The real live headcount, which is what a pledge's quantity IS — a gift
  // covers everyone in the group or it waits. Falls back only on a school with
  // no students loaded yet, so the demo still has a number to show.
  const headcount = await db.student.count({ where: { schoolId, isActive: true } });
  const scopeCount = headcount > 0 ? headcount : 240;
  console.log(`  · live headcount: ${headcount || '(none — using 240 for the demo)'}`);
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
      mode: 'FUND' as const, amountMinor: 18000 * scopeCount,
      dedicationKind: 'NONE' as const, dedicationText: null,
      visibility: 'ALUMNI' as const, status: 'ACCEPTED' as const,
    },
  ];
  for (const p of PLEDGES) {
    const already = await db.giftPledge.findFirst({
      where: { schoolId, alumniId: p.alumniId, giftItemId: p.giftItemId },
      select: { id: true },
    });
    if (!already) await db.giftPledge.create({ data: { schoolId, ...p } });
  }
  console.log(`  ✓ ${PLEDGES.length} pledges (one waiting on the office, one accepted)`);
  });

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
