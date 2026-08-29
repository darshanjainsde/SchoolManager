/**
 * Demo data for the fees module, for ONE school on a NON-production database.
 *
 * Its own script for the same reason `seed-alumni-demo.ts` is: `prisma/seed.ts`
 * builds a school from nothing and expects an empty database. This runs against
 * a staging school that is already live and already has students, so every
 * write is an upsert keyed on something stable and it touches only the fee
 * tables. Re-running it is safe and changes nothing the second time.
 *
 * The point is not volume. It is that EVERY screen in the module has something
 * real to show, and that the interesting states are all reachable:
 *
 *   - a term already overdue, so the late fee is a number rather than a rule
 *   - a payment waiting on the desk whose amount MATCHES the bill
 *   - one that is SHORT, so the mismatch warning has something to warn about
 *   - one already verified, carrying a receipt number
 *   - one rejected, so a parent can see what a rejection reads like
 *   - a sibling concession, a transport opt-in, and an RTE student who is
 *     billed but never chased
 *
 * Every table here carries `tenant_iso` with FORCE ROW LEVEL SECURITY, so the
 * writes go through `withTenant` rather than the platform client. Locally the
 * platform role happens to bypass RLS and either would appear to work; on a
 * database where it does not, the platform client silently writes nothing.
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

import { getPlatformPrisma, withTenant, disconnectAll, type TenantTx } from '@skoolos/db';

const SLUG = process.env.DEMO_SCHOOL_SLUG ?? 'raffles';
const DRY_RUN = process.env.DEMO_DRY_RUN === 'true';

/** A calendar date at IST midnight — the same thing a due date means. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000+05:30`);

/** Today, minus n days, as a DATE. Terms are anchored to the run so the demo
 *  is still "overdue by three weeks" whenever it is seeded, rather than
 *  drifting into being overdue by two years. */
function daysAgo(n: number): Date {
  const t = new Date();
  t.setUTCHours(0, 0, 0, 0);
  return new Date(t.getTime() - n * 86_400_000);
}
function daysAhead(n: number): Date {
  return daysAgo(-n);
}

const CATEGORIES = [
  { name: 'Tuition', description: 'Classroom teaching, learning materials and school upkeep', frequency: 'PER_TERM', isOptional: false, order: 0 },
  { name: 'Admission', description: 'One-time charge when a student joins the school', frequency: 'ONE_TIME', isOptional: false, order: 1 },
  { name: 'Transport', description: 'School bus, by route — only if you use the bus', frequency: 'PER_TERM', isOptional: true, order: 2 },
  { name: 'Exam', description: 'Question papers, answer sheets and result processing', frequency: 'PER_TERM', isOptional: false, order: 3 },
  { name: 'Computer lab', description: 'Computer room, internet and software for practicals', frequency: 'PER_TERM', isOptional: false, order: 4 },
  { name: 'Library', description: 'Books, periodicals and reading room upkeep', frequency: 'PER_TERM', isOptional: false, order: 5 },
] as const;

/** Per-term rupee amounts, by how senior the grade is. Rupees here, paise in the DB. */
const BY_ORDER: { upto: number; amounts: Record<string, number> }[] = [
  { upto: 2, amounts: { Tuition: 6000, Transport: 3000, Exam: 400, Library: 200, Admission: 5000 } },
  { upto: 5, amounts: { Tuition: 7500, Transport: 3000, Exam: 500, 'Computer lab': 400, Library: 250, Admission: 6000 } },
  { upto: 8, amounts: { Tuition: 9000, Transport: 3000, Exam: 600, 'Computer lab': 500, Library: 300, Admission: 7000 } },
  { upto: 99, amounts: { Tuition: 11000, Transport: 3000, Exam: 800, 'Computer lab': 600, Library: 350, Admission: 8000 } },
];

async function main() {
  const platform = getPlatformPrisma();
  const school = await platform.school.findUnique({ where: { slug: SLUG } });
  if (!school) throw new Error(`No school with slug "${SLUG}" on this database.`);
  const schoolId = school.id;

  const year = await platform.academicYear.findFirst({
    where: { schoolId, isCurrent: true },
    orderBy: { startDate: 'desc' },
  }) ?? await platform.academicYear.findFirst({ where: { schoolId }, orderBy: { startDate: 'desc' } });
  if (!year) throw new Error(`School "${SLUG}" has no academic year — seed the school first.`);

  const grades = await platform.grade.findMany({ where: { schoolId }, orderBy: { order: 'asc' } });
  const sections = await platform.classSection.findMany({
    where: { schoolId, academicYearId: year.id },
    select: { id: true, gradeId: true },
  });
  const students = await platform.student.findMany({
    where: { schoolId, isActive: true, classSectionId: { in: sections.map((s) => s.id) } },
    select: { id: true, firstName: true, lastName: true, admissionNo: true, classSectionId: true },
    orderBy: { admissionNo: 'asc' },
  });

  console.log(`Database : ${DB_URL!.replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`School   : ${school.name} (${SLUG})`);
  console.log(`Year     : ${year.name}`);
  console.log(`Grades   : ${grades.length}   Sections: ${sections.length}   Students: ${students.length}`);

  if (grades.length === 0 || students.length === 0) {
    throw new Error('That school has no grades or no students — run seed-school-demo.ts first.');
  }
  if (DRY_RUN) {
    console.log('\nDRY RUN — nothing written.');
    console.log('Would write: 6 categories, 3 terms (one overdue), a fee grid,');
    console.log('a late-fee rule, transport opt-ins, one RTE student, a sibling');
    console.log('concession, bills for every term, and 4 payments in 4 states.');
    return;
  }

  await withTenant(schoolId, async (tx) => {
    await seedStructure(tx, schoolId, year.id, grades);
    await seedExceptions(tx, schoolId, year.id, students, sections, grades);
  });
  // Billing and payments each need the previous transaction committed, because
  // they read what it wrote (the plan, then the invoices).
  await withTenant(schoolId, (tx) => seedBills(tx, schoolId, year.id));
  await withTenant(schoolId, (tx) => seedPayments(tx, schoolId));

  console.log('\nDone. Sign in as admin@' + SLUG + '.test and open Fees.');
}

async function seedStructure(tx: TenantTx, schoolId: string, academicYearId: string, grades: { id: string; order: number }[]) {
  for (const c of CATEGORIES) {
    const existing = await tx.feeCategory.findFirst({ where: { schoolId, name: c.name } });
    if (existing) {
      await tx.feeCategory.update({ where: { id: existing.id }, data: { archivedAt: null } });
    } else {
      await tx.feeCategory.create({ data: { schoolId, ...c } });
    }
  }
  const cats = await tx.feeCategory.findMany({ where: { schoolId, archivedAt: null } });
  const catByName = new Map(cats.map((c) => [c.name, c.id]));

  // One term already well past its due date, one due shortly, one ahead — so
  // the overdue path, the due-soon path and the not-yet path are all visible.
  const TERMS = [
    { name: 'Term 1', dueDate: daysAgo(24), order: 0 },
    { name: 'Term 2', dueDate: daysAhead(6), order: 1 },
    { name: 'Term 3', dueDate: daysAhead(96), order: 2 },
  ];
  for (const t of TERMS) {
    const existing = await tx.feeTerm.findFirst({ where: { schoolId, academicYearId, name: t.name } });
    if (existing) await tx.feeTerm.update({ where: { id: existing.id }, data: { dueDate: t.dueDate, order: t.order } });
    else await tx.feeTerm.create({ data: { schoolId, academicYearId, ...t } });
  }

  const plan = (await tx.feePlan.findFirst({ where: { schoolId, academicYearId, isActive: true }, orderBy: { version: 'desc' } }))
    ?? (await tx.feePlan.create({ data: { schoolId, academicYearId, version: 1, isActive: true } }));

  await tx.feePlanItem.deleteMany({ where: { schoolId, planId: plan.id } });
  const rows: { schoolId: string; planId: string; gradeId: string; categoryId: string; termId: null; amountMinor: number }[] = [];
  for (const g of grades) {
    const band = BY_ORDER.find((b) => g.order <= b.upto) ?? BY_ORDER[BY_ORDER.length - 1];
    for (const [name, rupees] of Object.entries(band.amounts)) {
      const categoryId = catByName.get(name);
      if (!categoryId) continue;
      rows.push({ schoolId, planId: plan.id, gradeId: g.id, categoryId, termId: null, amountMinor: rupees * 100 });
    }
  }
  await tx.feePlanItem.createMany({ data: rows });

  // ₹100/day after 3 grace days, capped at ₹1,000 — a rule a Rajasthan school
  // would actually run, and one whose cap is reachable in the demo.
  const settings = await tx.feeSettings.findUnique({ where: { schoolId } });
  const lateFee = { lateFeeMode: 'PER_DAY' as const, lateFeeAmountMinor: 10_000, lateFeeGraceDays: 3, lateFeeCapMinor: 100_000 };
  if (settings) await tx.feeSettings.update({ where: { schoolId }, data: lateFee });
  else await tx.feeSettings.create({ data: { schoolId, ...lateFee } });

  const bank = {
    accountName: 'Raffles Academy Education Society',
    accountNumber: '50100284791036',
    ifsc: 'HDFC0001432',
    bankName: 'HDFC Bank',
    branch: 'Sikar Road, Jaipur',
    upiId: 'rafflesacademy@hdfcbank',
    instructions: "Please write your child's admission number in the payment remark.",
    isVisible: true,
  };
  const existingBank = await tx.schoolBankDetail.findFirst({ where: { schoolId } });
  if (existingBank) await tx.schoolBankDetail.update({ where: { schoolId }, data: bank });
  else await tx.schoolBankDetail.create({ data: { schoolId, ...bank } });

  console.log(`  structure: ${cats.length} categories, 3 terms, ${rows.length} grid cells, late fee + bank details`);
}

/**
 * The exceptions, which are what make the module look like a real school
 * rather than a spreadsheet: a third of the roll on the bus, a pair of
 * siblings on a discount, and one RTE student who is billed and never chased.
 */
async function seedExceptions(
  tx: TenantTx,
  schoolId: string,
  academicYearId: string,
  students: { id: string; firstName: string; lastName: string; admissionNo: string; classSectionId: string | null }[],
  _sections: { id: string; gradeId: string }[],
  _grades: { id: string; order: number }[],
) {
  const plan = await tx.feePlan.findFirstOrThrow({
    where: { schoolId, academicYearId, isActive: true }, orderBy: { version: 'desc' },
  });
  const transport = await tx.feeCategory.findFirst({ where: { schoolId, name: 'Transport' } });
  const tuition = await tx.feeCategory.findFirst({ where: { schoolId, name: 'Tuition' } });

  // Deterministic rather than random: a demo that reshuffles on every seed is
  // impossible to write a bug report against.
  const onBus = students.filter((_, i) => i % 3 === 0);
  const rte = students.filter((_, i) => i % 17 === 5).slice(0, 4);
  const rteIds = new Set(rte.map((s) => s.id));

  for (const s of students) {
    const optIn = onBus.some((b) => b.id === s.id) && transport ? [transport.id] : [];
    const isRte = rteIds.has(s.id);
    const existing = await tx.feeAssignment.findFirst({ where: { studentId: s.id, planId: plan.id } });
    if (existing) {
      await tx.feeAssignment.update({ where: { id: existing.id }, data: { optInCategoryIds: optIn, isRte } });
    } else {
      await tx.feeAssignment.create({
        data: { schoolId, studentId: s.id, planId: plan.id, optInCategoryIds: optIn, isRte },
      });
    }
  }

  // Two sibling concessions and one staff-ward, on students who are NOT RTE —
  // stacking a discount on a bill nobody pays would demonstrate nothing.
  const eligible = students.filter((s) => !rteIds.has(s.id));
  const picks = [
    { student: eligible[1], percentBps: 1000, reason: 'Sibling concession — second child at the school' },
    { student: eligible[4], percentBps: 1000, reason: 'Sibling concession — second child at the school' },
    { student: eligible[7], percentBps: 5000, reason: 'Staff ward — half tuition' },
  ].filter((p) => p.student && tuition);

  for (const p of picks) {
    const already = await tx.feeConcession.findFirst({
      where: { schoolId, studentId: p.student!.id, categoryId: tuition!.id },
    });
    if (already) continue;
    await tx.feeConcession.create({
      data: {
        schoolId, studentId: p.student!.id, categoryId: tuition!.id,
        percentBps: p.percentBps, reason: p.reason,
      },
    });
  }

  console.log(`  exceptions: ${onBus.length} on the bus, ${rte.length} RTE, ${picks.length} concessions`);
}

/** Bills for every term whose due date has arrived or is close. */
async function seedBills(tx: TenantTx, schoolId: string, academicYearId: string) {
  const terms = await tx.feeTerm.findMany({ where: { schoolId, academicYearId }, orderBy: { order: 'asc' } });
  const plan = await tx.feePlan.findFirstOrThrow({
    where: { schoolId, academicYearId, isActive: true }, orderBy: { version: 'desc' },
  });
  const cats = await tx.feeCategory.findMany({ where: { schoolId, archivedAt: null } });
  const items = await tx.feePlanItem.findMany({ where: { schoolId, planId: plan.id } });
  const sections = await tx.classSection.findMany({
    where: { schoolId, academicYearId }, select: { id: true, gradeId: true },
  });
  const students = await tx.student.findMany({
    where: { schoolId, isActive: true, classSectionId: { in: sections.map((s) => s.id) } },
    select: { id: true, classSectionId: true },
    orderBy: { admissionNo: 'asc' },
  });
  const assigns = await tx.feeAssignment.findMany({ where: { schoolId, planId: plan.id } });
  const concessions = await tx.feeConcession.findMany({ where: { schoolId } });
  const yearName = (await tx.academicYear.findFirstOrThrow({ where: { id: academicYearId } })).name;

  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const assignBy = new Map(assigns.map((a) => [a.studentId, a]));
  const cell = new Map(items.map((i) => [`${i.gradeId}|${i.categoryId}`, i.amountMinor]));

  // Only the first two terms — Term 3 is months out, and a school does not
  // issue those bills yet. It is there so the "not billed yet" state exists.
  let created = 0;
  for (const term of terms.slice(0, 2)) {
    const isFirst = term.order === 0;
    for (const s of students) {
      const section = s.classSectionId ? sectionById.get(s.classSectionId) : undefined;
      if (!section) continue;
      const existing = await tx.feeInvoice.findFirst({ where: { studentId: s.id, termId: term.id } });
      if (existing) continue;

      const a = assignBy.get(s.id);
      const optIn = new Set(a?.optInCategoryIds ?? []);
      const isRte = a?.isRte ?? false;

      const lines: {
        schoolId: string; categoryId: string; categoryName: string; categoryDescription: string;
        grossMinor: number; concessionMinor: number; netMinor: number;
        concessionReason: string | null; isCollectible: boolean; order: number;
      }[] = [];
      let order = 0;
      for (const c of cats) {
        if (c.isOptional && !optIn.has(c.id)) continue;
        if (c.frequency === 'ONE_TIME' && !isFirst) continue;
        if (c.frequency === 'ANNUAL' && !isFirst) continue;
        const gross = cell.get(`${section.gradeId}|${c.id}`);
        if (!gross) continue;

        const mine = concessions.filter((x) => x.studentId === s.id && (x.categoryId === c.id || x.categoryId === null));
        let cut = 0;
        const reasons: string[] = [];
        for (const x of mine) {
          const remaining = gross - cut;
          if (remaining <= 0) break;
          const amt = x.percentBps != null
            ? Math.round((remaining * x.percentBps) / 10_000)
            : (x.amountMinor ?? 0);
          const applied = Math.min(Math.max(0, amt), remaining);
          if (applied > 0) { cut += applied; reasons.push(x.reason); }
        }
        lines.push({
          schoolId, categoryId: c.id, categoryName: c.name, categoryDescription: c.description,
          grossMinor: gross, concessionMinor: cut, netMinor: gross - cut,
          concessionReason: reasons.length ? reasons.join(' · ') : null,
          isCollectible: c.isCollectible && !isRte, order: order++,
        });
      }
      if (!lines.length) continue;

      const total = lines.reduce((acc, l) => acc + l.netMinor, 0);
      const series = `INV/${yearName}`;
      const [{ fee_next_number: seq }] = await tx.$queryRaw<{ fee_next_number: number }[]>`
        SELECT fee_next_number(${schoolId}::uuid, ${series}::text)
      `;
      const invoice = await tx.feeInvoice.create({
        data: {
          schoolId, studentId: s.id, termId: term.id, planId: plan.id,
          number: `${series}/${String(seq).padStart(5, '0')}`,
          dueDate: term.dueDate, totalMinor: total,
          lines: { create: lines },
        },
      });
      await tx.feeLedgerEntry.create({
        data: {
          schoolId, studentId: s.id, kind: 'DEBIT', amountMinor: total,
          refType: 'INVOICE', refId: invoice.id, narration: `${term.name} fees — ${invoice.number}`,
        },
      });
      created++;
    }
  }
  console.log(`  bills: ${created} issued across ${Math.min(2, terms.length)} terms`);
}

/**
 * Four payments in four states, so the verify desk has something to decide and
 * the parent portal has something to show. Each one exists to make a specific
 * branch of the UI reachable.
 */
async function seedPayments(tx: TenantTx, schoolId: string) {
  const already = await tx.feePayment.count({ where: { schoolId } });
  if (already > 0) {
    console.log(`  payments: ${already} already present, left alone`);
    return;
  }

  // Bills from the OVERDUE term, so the late fee is live on them.
  const overdue = await tx.feeTerm.findFirst({ where: { schoolId }, orderBy: { order: 'asc' } });
  if (!overdue) return;
  const invoices = await tx.feeInvoice.findMany({
    where: { schoolId, termId: overdue.id },
    include: { lines: { select: { isCollectible: true } }, student: { select: { firstName: true, lastName: true } } },
    orderBy: { number: 'asc' },
    take: 40,
  });
  const payable = invoices.filter((i) => i.lines.some((l) => l.isCollectible) && i.totalMinor > 0);
  if (payable.length < 4) {
    console.log('  payments: not enough collectible bills to demo with');
    return;
  }

  const settings = await tx.feeSettings.findUnique({ where: { schoolId } });
  const lateFeeFor = (dueDate: Date, paidOn: Date, outstanding: number) => {
    if (!settings || settings.lateFeeMode === 'NONE') return 0;
    const day = (x: Date) => Date.parse(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(x) + 'T00:00:00Z');
    const late = Math.max(0, Math.floor((day(paidOn) - day(dueDate)) / 86_400_000));
    const chargeable = late - settings.lateFeeGraceDays;
    if (chargeable <= 0) return 0;
    const raw = settings.lateFeeMode === 'FLAT'
      ? settings.lateFeeAmountMinor
      : settings.lateFeeAmountMinor * chargeable;
    const capped = settings.lateFeeCapMinor > 0 ? Math.min(raw, settings.lateFeeCapMinor) : raw;
    return Math.min(capped, outstanding);
  };

  const paidOn = daysAgo(2);
  const [exact, short, verified, rejected] = payable;

  // 1. WAITING, and the amount matches to the rupee — the happy path the clerk
  //    should be able to accept in one click.
  const exactDue = exact.totalMinor + lateFeeFor(exact.dueDate, paidOn, exact.totalMinor);
  await tx.feePayment.create({
    data: {
      schoolId, studentId: exact.studentId, invoiceId: exact.id, provider: 'MANUAL',
      providerRef: '421833949931', method: 'UPI', amountMinor: exactDue,
      status: 'SUBMITTED', paidOn, note: 'Paid from father’s account',
    },
  });

  // 2. WAITING and SHORT by ₹500 — the mismatch warning has to have something
  //    to warn about, or nobody knows it works.
  const shortDue = short.totalMinor + lateFeeFor(short.dueDate, paidOn, short.totalMinor);
  await tx.feePayment.create({
    data: {
      schoolId, studentId: short.studentId, invoiceId: short.id, provider: 'MANUAL',
      providerRef: 'HDFCN52420250829', method: 'NEFT_IMPS',
      amountMinor: Math.max(1, shortDue - 50_000),
      status: 'SUBMITTED', paidOn, note: 'Will pay the rest next week',
    },
  });

  // 3. ALREADY VERIFIED, with the ledger credit, the allocation and a receipt —
  //    so the Verified tab, the receipt number and a settled parent bill all
  //    have a real example.
  const vDue = verified.totalMinor + lateFeeFor(verified.dueDate, paidOn, verified.totalMinor);
  const vPayment = await tx.feePayment.create({
    data: {
      schoolId, studentId: verified.studentId, invoiceId: verified.id, provider: 'MANUAL',
      providerRef: '998877665544', method: 'UPI', amountMinor: vDue,
      status: 'VERIFIED', paidOn, verifiedAt: daysAgo(1),
    },
  });
  const lateOnVerified = lateFeeFor(verified.dueDate, paidOn, verified.totalMinor);
  if (lateOnVerified > 0) {
    await tx.feeLedgerEntry.create({
      data: {
        schoolId, studentId: verified.studentId, kind: 'DEBIT', amountMinor: lateOnVerified,
        refType: 'LATE_FEE', refId: verified.id,
        narration: `Late fee — paid after ${verified.dueDate.toISOString().slice(0, 10)}`,
        occurredAt: paidOn,
      },
    });
  }
  await tx.feeLedgerEntry.create({
    data: {
      schoolId, studentId: verified.studentId, kind: 'CREDIT', amountMinor: vDue,
      refType: 'PAYMENT', refId: vPayment.id, narration: 'Payment received — UPI · 998877665544',
    },
  });
  const vLines = await tx.feeInvoiceLine.findMany({ where: { invoiceId: verified.id }, orderBy: { order: 'asc' } });
  let left = verified.totalMinor;
  for (const l of vLines) {
    if (left <= 0) break;
    const take = Math.min(l.netMinor, left);
    if (take <= 0) continue;
    await tx.feeAllocation.create({
      data: { schoolId, paymentId: vPayment.id, invoiceId: verified.id, invoiceLineId: l.id, amountMinor: take },
    });
    left -= take;
  }
  const series = `RCP/${new Date().getFullYear()}`;
  const [{ fee_next_number: rseq }] = await tx.$queryRaw<{ fee_next_number: number }[]>`
    SELECT fee_next_number(${schoolId}::uuid, ${series}::text)
  `;
  await tx.feeReceipt.create({
    data: {
      schoolId, paymentId: vPayment.id, studentId: verified.studentId,
      number: `${series}/${String(rseq).padStart(5, '0')}`, amountMinor: vDue,
    },
  });

  // 4. REJECTED, so a parent can see what a turned-down claim reads like — and
  //    so the reason text gets exercised rather than assumed.
  await tx.feePayment.create({
    data: {
      schoolId, studentId: rejected.studentId, invoiceId: rejected.id, provider: 'MANUAL',
      providerRef: '111122223333', method: 'UPI', amountMinor: rejected.totalMinor,
      status: 'REJECTED', paidOn: daysAgo(4), verifiedAt: daysAgo(3),
      rejectionReason: 'We could not find this reference in our bank account.',
    },
  });

  console.log('  payments: 2 waiting (one exact, one short ₹500), 1 verified with a receipt, 1 rejected');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => disconnectAll());
