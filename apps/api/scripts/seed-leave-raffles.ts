/**
 * Seed LEAVE and the ACCOUNTS OFFICER on a STAGING school.
 *
 * The companion to `seed-pay-raffles.ts`, and inputs-only for the same reason:
 * it writes leave TYPES, QUOTAS and APPLICATIONS, and never a deduction. What
 * a month costs is produced by `/payroll/leave` proposing and somebody
 * pressing Charge — a seed that wrote its own `PayAdjustment` rows would prove
 * nothing about the thing being tested.
 *
 * It seeds the cases that are hard to get right, on purpose:
 *   · somebody comfortably INSIDE their quota (nothing should be proposed)
 *   · a teacher PAST it, so the arithmetic sentence has something to say
 *   · a staff member past the STAFF quota, which is a different number
 *   · a HALF DAY, which costs half a day of pay
 *   · a leave CROSSING a month boundary, which must not be charged twice
 *   · MATERNITY, which never deducts however long it runs
 *   · a PENDING application, which must be left out and merely warned about
 *
 * Idempotent: clears this school's leave applications and types, then rebuilds.
 *
 *   DATABASE_URL=… SEED_SCHOOL_SLUG=raffles pnpm --filter @skoolos/api exec tsx scripts/seed-leave-raffles.ts
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
if (/prod|oljrqinbjhpysgfwmtxw/i.test(url)) throw new Error('Refusing to seed what looks like production');
const SLUG = process.env.SEED_SCHOOL_SLUG ?? 'raffles';
const db = new PrismaClient({ datasources: { db: { url } } });

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Teacher days, staff days — different numbers, which is the whole point. */
const TYPES = [
  { builtin: 'SICK' as const, name: 'Sick leave', isPaid: true, teacher: 12, staff: 8, neverDeduct: false, carry: 0 },
  { builtin: 'CASUAL' as const, name: 'Casual leave', isPaid: true, teacher: 12, staff: 8, neverDeduct: false, carry: 6 },
  { builtin: 'EARNED' as const, name: 'Earned leave', isPaid: true, teacher: 15, staff: 10, neverDeduct: false, carry: 30 },
  { builtin: 'UNPAID' as const, name: 'Unpaid leave', isPaid: false, teacher: 0, staff: 0, neverDeduct: false, carry: 0 },
  { builtin: 'OTHER' as const, name: 'Maternity leave', isPaid: true, teacher: 182, staff: 182, neverDeduct: true, carry: 0 },
];

async function main() {
  const school = await db.school.findFirst({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!school) throw new Error(`No school with slug "${SLUG}"`);
  const schoolId = school.id;
  console.log(`Seeding leave for ${school.name}`);

  // ── the school's one deduction rule ────────────────────────────────────
  await db.school.update({
    where: { id: schoolId },
    data: { lopBasis: 'WORKING_DAY', lopCountsHalfDays: true },
  });

  // ── the vocabulary ─────────────────────────────────────────────────────
  await db.leaveApplication.deleteMany({ where: { schoolId } });
  await db.leaveAllocation.deleteMany({ where: { schoolId } });
  await db.leaveTypeDef.deleteMany({ where: { schoolId } });
  for (const t of TYPES) {
    await db.leaveTypeDef.create({
      data: {
        schoolId, builtin: t.builtin, name: t.name, isPaid: t.isPaid,
        defaultAnnual: t.teacher, defaultAnnualStaff: t.staff,
        neverDeduct: t.neverDeduct, carryForwardCap: t.carry, isActive: true,
      },
    });
  }
  const defs = await db.leaveTypeDef.findMany({ where: { schoolId } });
  const byBuiltin = new Map(defs.map((d) => [d.builtin, d]));
  console.log(`  ${defs.length} leave types`);

  // ── the accounts officer, with a login ─────────────────────────────────
  //
  // A STAFF row with `role: ACCOUNTS` opens the door; `canSeeSalary` is the
  // right, and it is granted here so staging can be tested end to end. In a
  // real school an admin grants it by name under Pay → Settings.
  const email = `accounts@${SLUG}.test`;
  const passwordHash = await argon2.hash('password', { type: argon2.argon2id });
  const officerUser = await db.user.upsert({
    // `schoolId_email`, not `email`: the address is unique PER SCHOOL, so the
    // same person can exist at two schools on this platform.
    where: { schoolId_email: { schoolId, email } },
    create: { schoolId, email, name: 'Meera Shah', role: 'STAFF', passwordHash, isActive: true, canSeeSalary: true },
    update: { schoolId, role: 'STAFF', passwordHash, isActive: true, canSeeSalary: true },
  });
  const existingOfficer = await db.staff.findFirst({ where: { schoolId, userId: officerUser.id } });
  const officer = existingOfficer
    ? await db.staff.update({ where: { id: existingOfficer.id }, data: { role: 'ACCOUNTS', isActive: true } })
    : await db.staff.create({
        data: {
          schoolId, firstName: 'Meera', lastName: 'Shah', role: 'ACCOUNTS',
          email, userId: officerUser.id, isActive: true, status: 'ACTIVE',
        },
      });
  console.log(`  accounts officer: ${email} / password`);

  // ── who takes leave ────────────────────────────────────────────────────
  const teachers = await db.teacher.findMany({
    where: { schoolId, isActive: true },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true },
    take: 8,
  });
  const staff = await db.staff.findMany({
    where: { schoolId, isActive: true, id: { not: officer.id } },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true },
    take: 4,
  });
  if (teachers.length < 4 || staff.length < 2) throw new Error('This school has too few people — seed the school first.');

  const casual = byBuiltin.get('CASUAL')!;
  const sick = byBuiltin.get('SICK')!;
  const unpaid = byBuiltin.get('UNPAID')!;
  const maternity = byBuiltin.get('OTHER')!;

  const app = (o: {
    person: { kind: 'TEACHER' | 'STAFF'; id: string };
    def: { id: string; builtin: string | null };
    from: string; to: string; halfDay?: boolean;
    status?: 'APPROVED' | 'PENDING'; reason: string;
  }) => ({
    schoolId,
    teacherId: o.person.kind === 'TEACHER' ? o.person.id : null,
    staffId: o.person.kind === 'STAFF' ? o.person.id : null,
    typeDefId: o.def.id,
    type: (o.def.builtin ?? 'OTHER') as 'SICK' | 'CASUAL' | 'EARNED' | 'UNPAID' | 'OTHER',
    startDate: D(o.from), endDate: D(o.to),
    halfDay: o.halfDay ?? false,
    status: o.status ?? ('APPROVED' as const),
    reason: o.reason,
  });

  const T = (i: number) => ({ kind: 'TEACHER' as const, id: teachers[i].id });
  const S = (i: number) => ({ kind: 'STAFF' as const, id: staff[i].id });

  const rows = [
    // 1. INSIDE the quota — four days against twelve. Proposes nothing, which
    //    is the case a seed usually forgets and the one that proves the rest.
    app({ person: T(0), def: casual, from: '2026-05-04', to: '2026-05-07', reason: 'Family wedding' }),

    // 2. PAST it. Nine earlier in the year plus five this month against twelve
    //    → two days over, and a sentence that says exactly that.
    app({ person: T(1), def: casual, from: '2026-06-01', to: '2026-06-09', reason: 'Extended family visit' }),
    app({ person: T(1), def: casual, from: '2026-09-21', to: '2026-09-25', reason: 'Personal' }),

    // 3. A HALF DAY — costs half a day of pay, and prints as ½ not 0.5.
    app({ person: T(2), def: casual, from: '2026-09-18', to: '2026-09-18', halfDay: true, reason: 'Hospital appointment' }),

    // 4. ACROSS a month boundary. September's run must charge September's
    //    slice and October's October's — never six days in one month.
    app({ person: T(3), def: unpaid, from: '2026-09-28', to: '2026-10-03', reason: 'Unpaid — out of station' }),

    // 5. MATERNITY. Six months, and not one rupee deducted: 26 weeks is the
    //    law, and a school that deducted for it would be breaking that law
    //    through our arithmetic.
    app({ person: T(4 % teachers.length), def: maternity, from: '2026-08-01', to: '2027-01-28', reason: 'Maternity leave' }),

    // 6. STAFF past the STAFF quota — nine days against eight. The same nine
    //    days would be inside a teacher's twelve, which is the whole reason
    //    the two numbers are kept apart.
    app({ person: S(0), def: casual, from: '2026-09-07', to: '2026-09-15', reason: 'Village visit' }),

    // 7. STAFF unpaid, a long one, to exercise the whole-month clamp.
    app({ person: S(1), def: unpaid, from: '2026-09-01', to: '2026-09-30', reason: 'Unpaid — personal' }),

    // 8. PENDING. Must be left OUT of the month and merely warned about: the
    //    office may still reject it, and deducting for a maybe is the one
    //    thing a payroll must not do.
    app({ person: T(1), def: sick, from: '2026-09-26', to: '2026-09-29', status: 'PENDING', reason: 'Fever' }),
  ];

  await db.leaveApplication.createMany({ data: rows });
  console.log(`  ${rows.length} leave applications (${rows.filter((r) => r.status === 'PENDING').length} pending)`);

  // ── per-teacher grants, so the grid is not empty ───────────────────────
  // Staff deliberately get NO allocation rows: their entitlement is the type's
  // staff default, which is what `PayLeaveService` charges them against.
  const year = await db.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } })
    ?? await db.academicYear.findFirst({ where: { schoolId }, orderBy: { startDate: 'desc' }, select: { id: true } });
  if (year) {
    const grants = teachers.flatMap((t) =>
      defs.filter((d) => d.defaultAnnual > 0).map((d) => ({
        schoolId, teacherId: t.id, typeDefId: d.id, academicYearId: year.id,
        allotted: d.defaultAnnual, carriedIn: 0,
      })),
    );
    await db.leaveAllocation.createMany({ data: grants, skipDuplicates: true });
    console.log(`  ${grants.length} allocations for ${teachers.length} teachers`);
  } else {
    console.log('  no academic year — allocations skipped, quotas fall back to the type defaults');
  }

  console.log('\nDone. Sign in as:');
  console.log(`  ${email} / password   (accounts officer — Pay + Leave, web and app)`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => void db.$disconnect());
