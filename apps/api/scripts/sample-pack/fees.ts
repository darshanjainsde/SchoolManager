import { randomUUID } from 'node:crypto';
import type { Prisma } from '@skoolos/db';
import { Ctx, many } from './ctx';
import { FEE_BANDS, FEE_CATEGORIES, SCHOOL } from './data';
import { D, addDays, iso } from './rng';

const AS_OF = D(SCHOOL.asOf);
const TERMS = [
  { name: 'Term 1', due: '2026-04-15', order: 0 },
  { name: 'Term 2', due: '2026-08-10', order: 1 },
  { name: 'Term 3', due: '2026-12-10', order: 2 },
];
const LATE = { mode: 'PER_DAY' as const, perDay: 5_000, grace: 5, cap: 100_000 };
const METHODS = [
  ['UPI', 0.52], ['NEFT_IMPS', 0.14], ['CASH', 0.16], ['CHEQUE', 0.06], ['CARD', 0.05], ['NETBANKING', 0.07],
] as const;

/** Reserves a gap-free block of numbers in one statement; returns the first. */
async function reserve(c: Ctx, series: string, n: number): Promise<number> {
  if (n === 0) return 1;
  const rows = await c.p.$queryRaw<{ value: number }[]>`
    INSERT INTO "FeeCounter" ("schoolId", "series", "value")
    VALUES (${c.schoolId}::uuid, ${series}::text, ${n}::int)
    ON CONFLICT ("schoolId", "series") DO UPDATE SET "value" = "FeeCounter"."value" + ${n}::int
    RETURNING "value"`;
  return rows[0]!.value - n + 1;
}

const lateFee = (due: Date, paid: Date, outstanding: number): number => {
  const days = Math.floor((paid.getTime() - due.getTime()) / 86_400_000) - LATE.grace;
  if (days <= 0) return 0;
  return Math.min(LATE.cap, LATE.perDay * days, outstanding);
};

/**
 * The fee desk as a working school has it by October: three terms in the
 * structure, two of them billed, and for each bill whatever really happens —
 * paid early, paid late with the late fee, paid in part, waiting for the
 * clerk, turned down, or simply not paid.
 */
export async function fees(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;

  await p.feeCategory.createMany({ data: FEE_CATEGORIES.map((cat) => ({ schoolId, ...cat })) });
  const cats = await p.feeCategory.findMany({ where: { schoolId }, orderBy: { order: 'asc' } });
  const catId = new Map(cats.map((x) => [x.name, x.id]));

  await p.feeTerm.createMany({
    data: TERMS.map((t) => ({ schoolId, academicYearId: c.yearId, name: t.name, dueDate: D(t.due), order: t.order })),
  });
  const terms = await p.feeTerm.findMany({ where: { schoolId }, orderBy: { order: 'asc' } });
  const plan = await p.feePlan.create({ data: { schoolId, academicYearId: c.yearId, version: 1, isActive: true } });

  const cell = new Map<string, number>();
  const items: Prisma.FeePlanItemCreateManyInput[] = [];
  c.gradeId.forEach((gradeId, g) => {
    const band = FEE_BANDS.find((b) => g >= b.from && g <= b.to)!;
    for (const [name, rupees] of Object.entries(band.amounts)) {
      const categoryId = catId.get(name);
      if (!categoryId) continue;
      items.push({ schoolId, planId: plan.id, gradeId, categoryId, termId: null, amountMinor: rupees * 100 });
      cell.set(`${g}|${categoryId}`, rupees * 100);
    }
  });
  await many(c, 'FeePlanItem', items, (b) => p.feePlanItem.createMany({ data: b }));
  await p.feeSettings.create({
    data: { schoolId, lateFeeMode: LATE.mode, lateFeeAmountMinor: LATE.perDay, lateFeeGraceDays: LATE.grace, lateFeeCapMinor: LATE.cap },
  });
  c.counts.FeeSettings = 1;

  const transport = catId.get('Transport')!;
  const tuition = catId.get('Tuition')!;
  await many(c, 'FeeAssignment', c.students.map((s): Prisma.FeeAssignmentCreateManyInput => ({
    schoolId, studentId: s.id, planId: plan.id, optInCategoryIds: s.onBus ? [transport] : [], isRte: s.isRte,
  })), (b) => p.feeAssignment.createMany({ data: b }));

  // Concessions: the younger of each sibling pair, and four children of staff.
  const siblings = (c as unknown as { siblings: { younger: string }[] }).siblings ?? [];
  const concessions: Prisma.FeeConcessionCreateManyInput[] = siblings
    .filter((s) => !c.students.find((x) => x.id === s.younger)?.isRte)
    .map((s) => ({ schoolId, studentId: s.younger, categoryId: tuition, percentBps: 1000, reason: 'Sibling concession — second child at the school', createdBy: c.accountsUserId }));
  const wards = r.shuffle(c.students.filter((s) => !s.isRte && !siblings.some((x) => x.younger === s.id))).slice(0, 4);
  for (const w of wards) {
    concessions.push({ schoolId, studentId: w.id, categoryId: tuition, percentBps: 5000, reason: 'Staff ward — half tuition', createdBy: c.accountsUserId });
  }
  await many(c, 'FeeConcession', concessions, (b) => p.feeConcession.createMany({ data: b }));
  const cutOf = new Map<string, { bps: number; reason: string }>();
  for (const x of concessions) cutOf.set(x.studentId, { bps: x.percentBps!, reason: x.reason });

  /* ── bills: Term 1 and Term 2 for everyone ───────────────────────────── */
  type Line = Prisma.FeeInvoiceLineCreateManyInput;
  const invoices: Prisma.FeeInvoiceCreateManyInput[] = [];
  const lines: Line[] = [];
  const ledger: Prisma.FeeLedgerEntryCreateManyInput[] = [];
  const meta = new Map<string, { lines: Line[]; due: Date; term: string; studentId: string; rte: boolean; total: number }>();

  const billing = terms.slice(0, 2);
  const first = await reserve(c, `INV/${SCHOOL.year}`, billing.length * c.students.length);
  let n = first;
  for (const term of billing) {
    for (const s of c.students) {
      const ls: Line[] = [];
      const invoiceId = randomUUID();
      let order = 0;
      for (const cat of cats) {
        if (cat.isOptional && !s.onBus) continue;
        if (cat.frequency === 'ONE_TIME' && term.order !== 0) continue;
        const gross = cell.get(`${s.gradeIdx}|${cat.id}`);
        if (!gross) continue;
        const cut = cat.id === tuition ? cutOf.get(s.id) : undefined;
        const concession = cut ? Math.round((gross * cut.bps) / 10_000) : 0;
        ls.push({
          id: randomUUID(), schoolId, invoiceId, categoryId: cat.id, categoryName: cat.name, categoryDescription: cat.description,
          grossMinor: gross, concessionMinor: concession, netMinor: gross - concession,
          concessionReason: concession ? cut!.reason : null, isCollectible: cat.isCollectible && !s.isRte, order: order++,
        });
      }
      const total = ls.reduce((a, l) => a + l.netMinor, 0);
      const number = `INV/${SCHOOL.year}/${String(n++).padStart(5, '0')}`;
      const issued = addDays(term.dueDate, -20);
      invoices.push({ id: invoiceId, schoolId, studentId: s.id, termId: term.id, planId: plan.id, number, dueDate: term.dueDate, totalMinor: total, issuedAt: issued });
      lines.push(...ls);
      ledger.push({ schoolId, studentId: s.id, kind: 'DEBIT', amountMinor: total, refType: 'INVOICE', refId: invoiceId, narration: `${term.name} fees — ${number}`, occurredAt: issued });
      meta.set(invoiceId, { lines: ls, due: term.dueDate, term: term.name, studentId: s.id, rte: s.isRte, total });
    }
  }
  await many(c, 'FeeInvoice', invoices, (b) => p.feeInvoice.createMany({ data: b }));
  await many(c, 'FeeInvoiceLine', lines, (b) => p.feeInvoiceLine.createMany({ data: b }), 5000);

  /* ── what each family does about it ──────────────────────────────────── */
  type Pay = {
    id: string; invoiceId: string; studentId: string; due: Date; paidOn: Date; amount: number; late: number;
    status: 'VERIFIED' | 'SUBMITTED' | 'REJECTED'; covers: number; method: string; ref: string; note: string | null;
  };
  const pays: Pay[] = [];
  const pickMethod = () => {
    let x = r.next();
    for (const [m, w] of METHODS) { if ((x -= w) < 0) return m; }
    return 'UPI';
  };
  // (school, provider, reference) is unique, so a reference is made unique by
  // construction — a running number inside it — rather than hoped for from a random draw.
  let refSeq = 0;
  const refFor = (m: string) => {
    refSeq += 1;
    return m === 'UPI' ? String(400_000_000_000 + refSeq * 7_919 + r.int(0, 6_000))
      : m === 'CASH' ? `CASH-${String(refSeq).padStart(5, '0')}`
        : m === 'CHEQUE' ? `CHQ ${100_000 + refSeq}`
          : m === 'CARD' ? `POS${10_000_000 + refSeq}` : `HDFCN${10_000_000_000 + refSeq * 13}`;
  };
  const day = (due: Date, from: number, to: number) => {
    const d = addDays(due, r.int(from, to));
    return d > AS_OF ? addDays(AS_OF, -r.int(1, 3)) : d;
  };

  for (const [invoiceId, m] of meta) {
    if (m.rte) continue; // billed, never chased
    const isFirst = m.term === 'Term 1';
    const u = r.next();
    const method = pickMethod();
    const mk = (over: Partial<Pay>): Pay => ({
      id: randomUUID(), invoiceId, studentId: m.studentId, due: m.due, paidOn: m.due, amount: m.total, late: 0,
      status: 'VERIFIED', covers: m.total, method, ref: refFor(method), note: null, ...over,
    });
    const full = (paidOn: Date) => {
      const late = lateFee(m.due, paidOn, m.total);
      return mk({ paidOn, late, amount: m.total + late });
    };
    if (isFirst) {
      if (u < 0.6) pays.push(full(day(m.due, -14, 0)));
      else if (u < 0.85) pays.push(full(day(m.due, 1, 15)));
      else if (u < 0.94) pays.push(full(day(m.due, 16, 85)));
      else if (u < 0.97) {
        const part = Math.round((m.total * r.int(55, 70)) / 100 / 100) * 100;
        pays.push(mk({ paidOn: day(m.due, 20, 60), amount: part, covers: part, note: 'Balance to be paid next month' }));
      }
    } else if (u < 0.5) pays.push(full(day(m.due, -16, 0)));
    else if (u < 0.68) pays.push(full(day(m.due, 1, 30)));
    else if (u < 0.76) {
      const part = Math.round((m.total * r.int(50, 75)) / 100 / 100) * 100;
      pays.push(mk({ paidOn: day(m.due, 5, 40), amount: part, covers: part, note: 'Will pay the rest soon' }));
    } else if (u < 0.8) {
      pays.push(mk({ paidOn: addDays(AS_OF, -r.int(1, 3)), status: 'SUBMITTED', note: 'Paid from father’s account' }));
    } else if (u < 0.81) {
      pays.push(mk({ paidOn: addDays(AS_OF, -7), status: 'REJECTED', note: null }));
    }
  }
  void iso;

  const verified = pays.filter((x) => x.status === 'VERIFIED').sort((a, b) => a.paidOn.getTime() - b.paidOn.getTime());
  const rcp0 = await reserve(c, `RCP/${AS_OF.getUTCFullYear()}`, verified.length);
  const receiptNo = new Map(verified.map((x, i) => [x.id, `RCP/${AS_OF.getUTCFullYear()}/${String(rcp0 + i).padStart(5, '0')}`]));

  const payRows: Prisma.FeePaymentCreateManyInput[] = [];
  const allocs: Prisma.FeeAllocationCreateManyInput[] = [];
  const receipts: Prisma.FeeReceiptCreateManyInput[] = [];
  const userOf = new Map(c.students.map((s) => [s.id, s.userId]));
  for (const x of pays) {
    const verifiedAt = x.status === 'SUBMITTED' ? null : (() => { const v = addDays(x.paidOn, 1); return v > AS_OF ? AS_OF : v; })();
    payRows.push({
      id: x.id, schoolId, studentId: x.studentId, invoiceId: x.invoiceId, provider: 'MANUAL', providerRef: x.ref,
      method: x.method as 'UPI', amountMinor: x.amount, status: x.status, paidOn: x.paidOn, note: x.note,
      submittedBy: userOf.get(x.studentId), submittedAt: x.paidOn,
      verifiedBy: verifiedAt ? c.accountsUserId : null, verifiedAt,
      rejectionReason: x.status === 'REJECTED' ? 'We could not find this reference in our bank account.' : null,
    });
    if (x.status !== 'VERIFIED') continue;
    ledger.push({ schoolId, studentId: x.studentId, kind: 'CREDIT', amountMinor: x.amount, refType: 'PAYMENT', refId: x.id, narration: `Payment received — ${x.method} · ${x.ref}`, occurredAt: x.paidOn });
    if (x.late > 0) {
      ledger.push({ schoolId, studentId: x.studentId, kind: 'DEBIT', amountMinor: x.late, refType: 'LATE_FEE', refId: x.invoiceId, narration: `Late fee — paid after ${iso(x.due)}`, occurredAt: x.paidOn });
    }
    let left = x.covers;
    for (const l of meta.get(x.invoiceId)!.lines) {
      if (left <= 0) break;
      const take = Math.min(l.netMinor, left);
      if (take <= 0) continue;
      allocs.push({ schoolId, paymentId: x.id, invoiceId: x.invoiceId, invoiceLineId: l.id!, amountMinor: take });
      left -= take;
    }
    receipts.push({ schoolId, paymentId: x.id, studentId: x.studentId, number: receiptNo.get(x.id)!, amountMinor: x.amount, issuedAt: verifiedAt! });
  }

  await many(c, 'FeeLedgerEntry', ledger, (b) => p.feeLedgerEntry.createMany({ data: b }), 5000);
  await many(c, 'FeePayment', payRows, (b) => p.feePayment.createMany({ data: b }));
  await many(c, 'FeeAllocation', allocs, (b) => p.feeAllocation.createMany({ data: b }), 5000);
  await many(c, 'FeeReceipt', receipts, (b) => p.feeReceipt.createMany({ data: b }));
}
