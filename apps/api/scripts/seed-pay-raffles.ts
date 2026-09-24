/**
 * Seed Pay on a STAGING school with good data, using the school's EXISTING
 * teachers and staff: the SALARY feature switched on, a state so professional
 * tax and ESI are real, nine pay grades with bands and one custom split, every
 * person on a grade with a figure inside their band, bank details and PAN, a
 * few tax declarations, and the exceptions a real school has — someone with no
 * bank account, an arrears line, a month of unpaid leave.
 *
 * IT SEEDS INPUTS ONLY. Not one payslip is written here: payslips are produced
 * by running the months through the real engine afterwards (open → calculate →
 * approve → lock → paid, over the API). A seed that wrote its own payslips
 * would prove nothing about the thing being tested.
 *
 * Idempotent: every run clears this school's pay data first (runs, payslips,
 * adjustments, declarations, employee pay, grades) and rebuilds it. Never run
 * this against production — the workflow refuses, and so does this file.
 *
 *   DATABASE_URL=… SEED_SCHOOL_SLUG=raffles pnpm --filter @skoolos/api exec tsx scripts/seed-pay-raffles.ts
 *
 * Deliberately a plain PrismaClient with an explicit URL — the repo's
 * `loadEnv()` would read the local .env over the exported URL (see the staging
 * memory note), and the script must never touch the wrong database.
 */
import { PrismaClient, type Prisma } from '@prisma/client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
if (/prod|oljrqinbjhpysgfwmtxw/i.test(url)) throw new Error('Refusing to seed what looks like production');
const SLUG = process.env.SEED_SCHOOL_SLUG ?? 'raffles';
const db = new PrismaClient({ datasources: { db: { url } } });

/** Deterministic, so a re-seed gives the same school and diffs stay readable. */
let seed = 20260924;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
/** A salary a school would actually write down: whole hundreds. */
const near = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) / 100) * 100;
const L = (rupees: number) => rupees * 100;

const PAN_L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pan = (i: number) => `A${PAN_L[i % 26]}${PAN_L[(i * 7) % 26]}PK${String(1000 + i).slice(0, 4)}${PAN_L[(i * 3) % 26]}`;
const IFSC = ['SBIN0001234', 'HDFC0000567', 'ICIC0002345', 'PUNB0123456', 'BARB0RAJAST'];

/**
 * The grades. Bands are what a Jaipur private school actually pays in 2026,
 * and every one of them leaves Basic at the shipped 50% — except the driver
 * grade, which carries a higher Basic so the split override is exercised too.
 */
const GRADES: { name: string; description: string; min: number; max: number; order: number; basicBps?: number }[] = [
  { name: 'Principal', description: 'Principal', min: 90_000, max: 140_000, order: 10 },
  { name: 'PGT', description: 'Post Graduate Teacher', min: 38_000, max: 62_000, order: 20 },
  { name: 'TGT', description: 'Trained Graduate Teacher', min: 30_000, max: 46_000, order: 30 },
  { name: 'PRT', description: 'Primary Teacher', min: 22_000, max: 34_000, order: 40 },
  { name: 'Sports', description: 'Sports teacher', min: 24_000, max: 38_000, order: 50 },
  { name: 'Librarian', description: 'Librarian', min: 22_000, max: 32_000, order: 60 },
  { name: 'Office', description: 'Office staff', min: 18_000, max: 30_000, order: 70 },
  { name: 'Security', description: 'Security', min: 15_000, max: 21_000, order: 80 },
  // Under the ESI ceiling on purpose, and a heavier Basic — so the grade
  // override, ESI, and the wage-share check are all exercised by real rows.
  { name: 'Driver', description: 'Driver', min: 15_000, max: 20_000, order: 90, basicBps: 6000 },
  { name: 'Helper', description: 'Helper and support staff', min: 12_000, max: 18_000, order: 100 },
];

/** Which grade a staff member's job maps to. */
const STAFF_GRADE: Record<string, string> = {
  OFFICE: 'Office', SUPPORT: 'Helper', DRIVER: 'Driver', HELPER: 'Helper',
  SECURITY: 'Security', LIBRARIAN: 'Librarian', SPORTS: 'Sports', OTHER: 'Helper',
};

async function main() {
  const school = await db.school.findUnique({ where: { slug: SLUG }, select: { id: true, name: true, countryCode: true, region: true } });
  if (!school) throw new Error(`No school with slug "${SLUG}"`);
  const schoolId = school.id;
  console.log(`Seeding Pay on ${school.name} (${SLUG})`);

  // ── the module has to be ON, and a state has to be set ──────────────────
  // SALARY is in no tier, so without the override every route 403s. And with
  // no region, professional tax and ESI are silently zero — which would make
  // the whole seed look right and be wrong.
  await db.featureOverride.upsert({
    where: { schoolId_featureKey: { schoolId, featureKey: 'SALARY' } },
    create: { schoolId, featureKey: 'SALARY', enabled: true },
    update: { enabled: true },
  });
  await db.school.update({
    where: { id: schoolId },
    data: { countryCode: 'IN', currency: 'INR', region: school.region ?? 'RJ', taxYearStartMonth: 4 },
  });

  // Somebody must hold the salary right. The guard self-heals to the earliest
  // admin, but seeding it makes the staging login work on the first request.
  const admin = await db.user.findFirst({
    where: { schoolId, role: 'SCHOOL_ADMIN', isActive: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, email: true },
  });
  if (admin) await db.user.update({ where: { id: admin.id }, data: { canSeeSalary: true } });
  console.log(`  salary right → ${admin?.email ?? '(no admin found)'}`);

  // ── idempotent: clear this school's pay data ────────────────────────────
  // Order matters: payslips and adjustments reference runs.
  await db.payslip.deleteMany({ where: { schoolId } });
  await db.payAdjustment.deleteMany({ where: { schoolId } });
  await db.payRun.deleteMany({ where: { schoolId } });
  await db.taxDeclaration.deleteMany({ where: { schoolId } });
  await db.employeePay.deleteMany({ where: { schoolId } });
  await db.payGrade.deleteMany({ where: { schoolId } });

  // ── the components, as the app seeds them on first use ──────────────────
  // basic 50% of gross, house rent 40% of basic, the rest to a balance line.
  const existingComponents = await db.payComponent.count({ where: { schoolId } });
  if (existingComponents === 0) {
    await db.payComponent.createMany({
      data: [
        { schoolId, key: 'basic', name: 'Basic', kind: 'EARNING', calc: 'PCT_OF_GROSS', rateBps: 5000, taxable: true, isWages: true, retirementBase: true, healthBase: true, gratuityBase: true, prorate: true, order: 1, hint: 'The base for provident fund, gratuity and bonus. Keep it at half of gross or more.' },
        { schoolId, key: 'da', name: 'Dearness allowance', kind: 'EARNING', calc: 'FIXED', taxable: true, isWages: true, retirementBase: true, healthBase: true, gratuityBase: true, prorate: true, order: 2, hint: 'Government and aided schools carry it; most private schools leave it at zero.' },
        { schoolId, key: 'hra', name: 'House rent allowance', kind: 'EARNING', calc: 'PCT_OF_BASIC', rateBps: 4000, taxable: true, isWages: false, retirementBase: false, healthBase: true, gratuityBase: false, prorate: true, order: 3, hint: 'Exempt against rent paid, on the old regime only.' },
        { schoolId, key: 'conveyance', name: 'Conveyance', kind: 'EARNING', calc: 'FIXED', taxable: true, isWages: false, retirementBase: false, healthBase: true, gratuityBase: false, prorate: true, order: 4, hint: 'A convention now, not an exemption.' },
        { schoolId, key: 'special', name: 'Special allowance', kind: 'EARNING', calc: 'BALANCE', taxable: true, isWages: false, retirementBase: false, healthBase: true, gratuityBase: false, prorate: true, order: 9, hint: 'Whatever is left after the others, so the parts add to the agreed gross.' },
      ],
      skipDuplicates: true,
    });
  }

  // ── grades ──────────────────────────────────────────────────────────────
  const gradeId = new Map<string, string>();
  for (const g of GRADES) {
    const row = await db.payGrade.create({
      data: {
        schoolId, name: g.name, description: g.description,
        bandMinMinor: L(g.min), bandMaxMinor: L(g.max),
        overrides: (g.basicBps ? { basic: { rateBps: g.basicBps } } : {}) as Prisma.InputJsonValue,
        order: g.order, active: true, createdById: admin?.id ?? null,
      },
      select: { id: true },
    });
    gradeId.set(g.name, row.id);
  }
  console.log(`  ${GRADES.length} grades`);

  // ── who is on the payroll ───────────────────────────────────────────────
  const teachers = await db.teacher.findMany({
    where: { schoolId, isActive: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true },
  });
  const staff = await db.staff.findMany({
    where: { schoolId, isActive: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, role: true },
  });
  if (teachers.length === 0 && staff.length === 0) throw new Error('This school has nobody on the roll — seed the school first.');

  const byName = new Map(GRADES.map((g) => [g.name, g]));
  const rows: Prisma.EmployeePayCreateManyInput[] = [];
  /** Pay has been in force since the start of this tax year, so YTD is real. */
  const FROM = new Date('2026-04-01T00:00:00.000Z');

  // Teachers spread across the teaching grades: one principal, then a
  // realistic mix. The seniormost by name order gets Principal so it is stable.
  const teachingGrades = ['PGT', 'TGT', 'TGT', 'PRT', 'TGT', 'PGT', 'PRT'];
  teachers.forEach((t, i) => {
    const name = i === 0 ? 'Principal' : teachingGrades[i % teachingGrades.length];
    const g = byName.get(name)!;
    // Everyone starts INSIDE their band. One person ends up outside it anyway,
    // and deliberately: the July raise below lifts a top-of-band TGT past the
    // band's ceiling, which is exactly how it happens in a real school and
    // gives the month's OUT_OF_BAND warning something true to point at.
    const gross = near(g.min, g.max);
    // A few without a bank account, on purpose — it is the exception the month
    // screen exists to surface, and a real school always has two or three.
    const noBank = i % 17 === 5;
    rows.push({
      schoolId, personKind: 'TEACHER', teacherId: t.id, staffId: null,
      payGradeId: gradeId.get(name)!, effectiveFrom: FROM, monthlyGrossMinor: L(gross),
      fixedAmounts: { conveyance: L(1_600) } as Prisma.InputJsonValue,
      taxRegime: i % 4 === 0 ? 'OLD' : 'NEW',
      pfOptIn: true, pfOnActual: false, esiExempt: false, localTaxExempt: false,
      paidThroughVacation: true, contractMonths: 12, fixedTerm: false,
      joinedOn: new Date(Date.UTC(2019 + (i % 6), (i * 3) % 12, 1 + (i % 27))),
      pan: pan(i), uan: `10${String(100000000 + i * 7919).slice(0, 10)}`,
      bankAccount: noBank ? null : `3${String(100000000000 + i * 104729).slice(0, 11)}`,
      bankIfsc: noBank ? null : IFSC[i % IFSC.length],
      bankName: noBank ? null : 'State Bank of India',
      createdById: admin?.id ?? null,
    });
  });

  staff.forEach((s, i) => {
    const name = STAFF_GRADE[s.role] ?? 'Helper';
    const g = byName.get(name)!;
    const gross = near(g.min, g.max);
    const noBank = i % 11 === 4;
    rows.push({
      schoolId, personKind: 'STAFF', teacherId: null, staffId: s.id,
      payGradeId: gradeId.get(name)!, effectiveFrom: FROM, monthlyGrossMinor: L(gross),
      fixedAmounts: { conveyance: L(1_200) } as Prisma.InputJsonValue,
      taxRegime: 'NEW',
      pfOptIn: true, pfOnActual: false, esiExempt: false, localTaxExempt: false,
      paidThroughVacation: true, contractMonths: 12, fixedTerm: false,
      joinedOn: new Date(Date.UTC(2020 + (i % 5), (i * 5) % 12, 1 + (i % 27))),
      pan: pan(teachers.length + i), uan: `10${String(100000000 + (teachers.length + i) * 7919).slice(0, 10)}`,
      bankAccount: noBank ? null : `3${String(100000000000 + (teachers.length + i) * 104729).slice(0, 11)}`,
      bankIfsc: noBank ? null : IFSC[i % IFSC.length],
      bankName: noBank ? null : 'Punjab National Bank',
      createdById: admin?.id ?? null,
    });
  });

  await db.employeePay.createMany({ data: rows });
  console.log(`  ${rows.length} on pay (${teachers.length} teachers, ${staff.length} staff)`);

  // ── a July raise for the TGTs, backdated ────────────────────────────────
  // A second row for the same people, from 1 July: the engine must pick the
  // row in force for the month it is computing, so June differs from August.
  // This is the behaviour that makes a backdated increment a computation.
  //
  // It is NOT capped at the band's ceiling, on purpose. A raise that lifts
  // someone past the top of their grade is a real thing a school does, and it
  // is precisely what the OUT_OF_BAND warning exists to catch — a warning
  // with nothing to warn about proves nothing.
  const tgtId = gradeId.get('TGT')!;
  const tgts = rows.filter((r) => r.payGradeId === tgtId).slice(0, 8);
  await db.employeePay.createMany({
    data: tgts.map((r) => ({
      ...r,
      effectiveFrom: new Date('2026-07-01T00:00:00.000Z'),
      monthlyGrossMinor: Math.round((r.monthlyGrossMinor as number) * 1.06 / 100) * 100,
      note: 'Grade raise · TGT',
    })),
  });
  console.log(`  ${tgts.length} TGT raises from 1 July`);

  // ── tax declarations: rent, 80C, a home loan ────────────────────────────
  const decl = rows.filter((_, i) => i % 3 === 0).slice(0, 24);
  await db.taxDeclaration.createMany({
    data: decl.map((r, i) => ({
      schoolId, personKind: r.personKind, teacherId: r.teacherId ?? null, staffId: r.staffId ?? null,
      taxYear: 2026,
      regime: r.taxRegime as 'NEW' | 'OLD',
      rentAnnualMinor: L(near(96_000, 240_000)),
      metro: false,
      landlordPan: i % 4 === 0 ? pan(200 + i) : null,
      section80cMinor: L(near(20_000, 150_000)),
      section80dMinor: i % 3 === 0 ? L(25_000) : L(0),
      homeLoanInterestMinor: i % 5 === 0 ? L(near(60_000, 200_000)) : L(0),
      status: 'SUBMITTED',
      submittedAt: new Date('2026-05-15T00:00:00.000Z'),
    })),
    skipDuplicates: true,
  });
  console.log(`  ${decl.length} tax declarations`);

  // ── the exceptions a real month has ─────────────────────────────────────
  // September, the month the school will run on staging: one arrears line and
  // two people on unpaid leave, so the month screen has something true to say.
  const adjFor = rows.slice(1, 4);
  await db.payAdjustment.createMany({
    data: [
      {
        schoolId, personKind: adjFor[0].personKind, teacherId: adjFor[0].teacherId ?? null, staffId: adjFor[0].staffId ?? null,
        periodYear: 2026, periodMonth: 9, label: 'Arrears · April to June', kind: 'EARNING',
        amountMinor: L(4_800), taxable: true, lopDays: 0, note: 'Backdated increment', createdById: admin?.id ?? null,
      },
      {
        schoolId, personKind: adjFor[1].personKind, teacherId: adjFor[1].teacherId ?? null, staffId: adjFor[1].staffId ?? null,
        periodYear: 2026, periodMonth: 9, label: 'Unpaid leave', kind: 'DEDUCTION',
        amountMinor: 0, taxable: false, lopDays: 3, note: 'Three days', createdById: admin?.id ?? null,
      },
      {
        schoolId, personKind: adjFor[2].personKind, teacherId: adjFor[2].teacherId ?? null, staffId: adjFor[2].staffId ?? null,
        periodYear: 2026, periodMonth: 9, label: 'Festival advance recovery', kind: 'DEDUCTION',
        amountMinor: L(2_000), taxable: false, lopDays: 0, createdById: admin?.id ?? null,
      },
    ],
  });
  console.log('  3 adjustments on September (arrears, unpaid leave, a recovery)');

  const onPay = rows.length;
  const monthly = rows.reduce((a, r) => a + (r.monthlyGrossMinor as number), 0);
  console.log(`\nInputs seeded. ${onPay} people, ₹${Math.round(monthly / 100).toLocaleString('en-IN')} a month of agreed pay.`);
  console.log('No payslip was written here — run the months through the API to produce them.');
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
