import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { StorageService } from '../../common/storage/storage.service';
import { computeLateFee, describeLateFeeRule, ruleFromSettings } from './late-fee';

/**
 * Read paths for the office screens and the parent portal.
 *
 * Kept separate from the services that write, because the read shapes are
 * driven by what a screen renders rather than by what the domain is — and
 * because these are the queries that have to stay fast at 10,000 students.
 * List screens never fan out per row.
 */
/** The zero row, so an empty result and a full one have the same shape. */
const EMPTY_TOTALS = {
  students: 0, owing: 0, billedMinor: 0, paidMinor: 0, lateFeeMinor: 0, dueMinor: 0,
};

@Injectable()
export class FeeQueryService {
  constructor(private readonly storage: StorageService) {}

  /**
   * The school's late-fee rule, defaulted rather than created. A read path
   * must not write — `studentFees` is hit by every parent opening the app, and
   * a row-creating read turns that into a write storm on first load.
   */
  private async lateFeeRule(tx: TenantTx, schoolId: string) {
    const row = await tx.feeSettings.findUnique({ where: { schoolId } });
    return ruleFromSettings(
      row ?? { lateFeeMode: 'NONE', lateFeeAmountMinor: 0, lateFeeGraceDays: 0, lateFeeCapMinor: 0 },
    );
  }

  /** The verify desk. Payments awaiting a decision, newest claim first. */
  async paymentsToVerify(schoolId: string, status: 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'REVERSED' = 'SUBMITTED') {
    return withTenant(schoolId, async (tx) => {
      const rule = await this.lateFeeRule(tx, schoolId);
      const payments = await tx.feePayment.findMany({
        where: { schoolId, status },
        include: {
          student: {
            select: {
              id: true, firstName: true, lastName: true, admissionNo: true,
              classSection: { select: { name: true, grade: { select: { name: true } } } },
            },
          },
          invoice: {
            select: {
              id: true, number: true, totalMinor: true, dueDate: true,
              term: { select: { name: true } },
              lines: { select: { isCollectible: true } },
              allocations: { select: { amountMinor: true } },
            },
          },
          receipt: { select: { number: true } },
        },
        orderBy: { submittedAt: 'desc' },
        take: 200,
      });

      // Presigning is per row and unavoidable (each key is different), but it
      // is the ONLY per-row work — everything else came back in one query.
      return Promise.all(
        payments.map(async (p) => {
          // What the parent was actually quoted: the bill, less anything already
          // paid against it, plus the late fee as of the day they say they paid.
          // Comparing against the bill total alone would mark EVERY late payment
          // as an overpayment, and the clerk would learn to ignore the flag.
          const alreadyPaid = p.invoice?.allocations.reduce((a, x) => a + x.amountMinor, 0) ?? 0;
          const principal = p.invoice ? p.invoice.totalMinor - alreadyPaid : 0;
          const lateFeeMinor = p.invoice
            ? computeLateFee({
                rule,
                dueDate: p.invoice.dueDate,
                asOf: p.paidOn,
                outstandingMinor: principal,
                isCollectible: p.invoice.lines.some((l) => l.isCollectible),
              })
            : 0;
          const expectedMinor = principal + lateFeeMinor;

          return {
          id: p.id,
          status: p.status,
          method: p.method,
          amountMinor: p.amountMinor,
          providerRef: p.providerRef,
          paidOn: p.paidOn,
          note: p.note,
          submittedAt: p.submittedAt,
          verifiedAt: p.verifiedAt,
          rejectionReason: p.rejectionReason,
          /** What the school told the family when it accepted this. */
          ackNote: p.ackNote,
          receiptNumber: p.receipt?.number ?? null,
          proofUrl: p.proofKey ? await this.storage.presignedGet(p.proofKey, 900) : null,
          student: {
            id: p.student.id,
            name: `${p.student.firstName} ${p.student.lastName}`.trim(),
            admissionNo: p.student.admissionNo,
            className: p.student.classSection
              ? `${p.student.classSection.grade.name}-${p.student.classSection.name}`
              : null,
          },
          invoice: p.invoice
            ? {
                id: p.invoice.id,
                number: p.invoice.number,
                totalMinor: p.invoice.totalMinor,
                dueDate: p.invoice.dueDate,
                termName: p.invoice.term.name,
                lateFeeMinor,
                expectedMinor,
              }
            : null,
          /**
           * Pre-computed so the clerk is never doing arithmetic. This is what
           * turns "open the screenshot and squint" into a glance.
           */
          amountMatchesBill: p.invoice ? expectedMinor === p.amountMinor : null,
          };
        }),
      );
    });
  }

  /**
   * The office's collection summary. Both clocks the pitch called for:
   * what was collected, and — once a gateway exists — what has settled.
   * Today everything verified is in the school's own account already, so
   * settled equals collected; the shape is here so the screen does not change
   * when that stops being true.
   */
  async collectionSummary(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const [today, pending, ledger] = await Promise.all([
        tx.feePayment.groupBy({
          by: ['method'],
          where: { schoolId, status: 'VERIFIED', verifiedAt: { gte: startOfDay } },
          _sum: { amountMinor: true },
          _count: { _all: true },
        }),
        tx.feePayment.aggregate({
          where: { schoolId, status: 'SUBMITTED' },
          _sum: { amountMinor: true },
          _count: { _all: true },
        }),
        tx.feeLedgerEntry.groupBy({
          by: ['kind'],
          where: { schoolId },
          _sum: { amountMinor: true },
        }),
      ]);

      const billed = ledger.find((r) => r.kind === 'DEBIT')?._sum.amountMinor ?? 0;
      const collected = ledger.find((r) => r.kind === 'CREDIT')?._sum.amountMinor ?? 0;

      return {
        todayByMethod: today.map((t) => ({
          method: t.method,
          amountMinor: t._sum.amountMinor ?? 0,
          count: t._count._all,
        })),
        todayTotalMinor: today.reduce((a, t) => a + (t._sum.amountMinor ?? 0), 0),
        awaitingReviewMinor: pending._sum.amountMinor ?? 0,
        awaitingReviewCount: pending._count._all,
        billedMinor: billed,
        collectedMinor: collected,
        outstandingMinor: billed - collected,
      };
    });
  }

  /**
   * One student's complete fee position — the screen a parent opens and the
   * one the office opens during a dispute. Same data, same query.
   */
  async studentFees(schoolId: string, studentId: string) {
    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId, schoolId },
        select: {
          id: true, firstName: true, lastName: true, admissionNo: true,
          classSection: { select: { name: true, grade: { select: { name: true } } } },
        },
      });
      if (!student) throw new ApiError('NOT_FOUND', 'Student not found', 404);

      const [rule, invoices, payments, ledger] = await Promise.all([
        this.lateFeeRule(tx, schoolId),
        tx.feeInvoice.findMany({
          where: { schoolId, studentId, cancelledAt: null },
          include: {
            lines: { orderBy: { order: 'asc' } },
            term: { select: { name: true } },
            allocations: { select: { amountMinor: true } },
          },
          orderBy: { dueDate: 'asc' },
        }),
        tx.feePayment.findMany({
          where: { schoolId, studentId },
          include: { receipt: { select: { number: true, issuedAt: true } } },
          orderBy: { submittedAt: 'desc' },
        }),
        tx.feeLedgerEntry.findMany({
          where: { schoolId, studentId },
          orderBy: { occurredAt: 'desc' },
          take: 200,
        }),
      ]);

      const billed = ledger.filter((l) => l.kind === 'DEBIT').reduce((a, l) => a + l.amountMinor, 0);
      const paid = ledger.filter((l) => l.kind === 'CREDIT').reduce((a, l) => a + l.amountMinor, 0);
      const now = new Date();

      return {
        student: {
          id: student.id,
          name: `${student.firstName} ${student.lastName}`.trim(),
          admissionNo: student.admissionNo,
          className: student.classSection
            ? `${student.classSection.grade.name}-${student.classSection.name}`
            : null,
        },
        /** Positive means owed. Negative is an advance credit sitting with the school. */
        balanceMinor: billed - paid,
        billedMinor: billed,
        paidMinor: paid,
        lateFeeRule: describeLateFeeRule(rule),
        invoices: invoices.map((inv) => {
          const allocated = inv.allocations.reduce((a, x) => a + x.amountMinor, 0);
          const outstanding = inv.totalMinor - allocated;
          // Charged only on the collectible part: an RTE line is reimbursed by
          // the state, so its lateness is not the parent's.
          const collectible = inv.lines.some((l) => l.isCollectible);
          const lateFeeMinor = computeLateFee({
            rule,
            dueDate: inv.dueDate,
            asOf: now,
            outstandingMinor: outstanding,
            isCollectible: collectible,
          });
          return {
            id: inv.id,
            number: inv.number,
            termName: inv.term.name,
            dueDate: inv.dueDate,
            totalMinor: inv.totalMinor,
            paidMinor: allocated,
            /** What is owed on the bill itself, before any late fee. */
            principalDueMinor: outstanding,
            lateFeeMinor,
            /** What the parent actually has to send today. */
            dueMinor: outstanding + lateFeeMinor,
            isPaid: allocated >= inv.totalMinor,
            isOverdue: outstanding > 0 && inv.dueDate < now,
            lines: inv.lines.map((l) => ({
              categoryName: l.categoryName,
              categoryDescription: l.categoryDescription,
              grossMinor: l.grossMinor,
              concessionMinor: l.concessionMinor,
              netMinor: l.netMinor,
              concessionReason: l.concessionReason,
              isCollectible: l.isCollectible,
            })),
          };
        }),
        payments: payments.map((p) => ({
          id: p.id,
          status: p.status,
          method: p.method,
          amountMinor: p.amountMinor,
          providerRef: p.providerRef,
          paidOn: p.paidOn,
          submittedAt: p.submittedAt,
          verifiedAt: p.verifiedAt,
          rejectionReason: p.rejectionReason,
          /** The school's acknowledgement, shown verbatim beside the receipt. */
          ackNote: p.ackNote,
          receiptNumber: p.receipt?.number ?? null,
        })),
        ledger: ledger.map((l) => ({
          kind: l.kind,
          amountMinor: l.amountMinor,
          narration: l.narration,
          occurredAt: l.occurredAt,
        })),
      };
    });
  }

  /**
   * Fees by student — ONE row per child, and the only list of its kind.
   *
   * Deliberately not a "defaulters" endpoint. Darshan's call: show the whole
   * roll and let a filter narrow it to who owes, rather than two screens
   * computing the same numbers two ways and drifting apart. `owingOnly` is
   * therefore a filter, not a different query.
   *
   * Aggregated in memory from four queries rather than one per student: the
   * per-student loop is the shape that timed the fees seed out against a remote
   * pooler, and a list screen is hit far more often than a seed.
   */
  async studentFeeList(
    schoolId: string,
    opts: {
      termId?: string;
      gradeId?: string;
      /** Only students with something still due (late fee included). */
      owingOnly?: boolean;
      /** Only students whose due date has passed and who still owe. */
      overdueOnly?: boolean;
      minDueMinor?: number;
      /** Name or admission number, case-insensitive. */
      q?: string;
      take?: number;
    } = {},
  ) {
    const take = Math.min(Math.max(opts.take ?? 200, 1), 500);

    return withTenant(schoolId, async (tx) => {
      const now = new Date();
      const rule = await this.lateFeeRule(tx, schoolId);

      const sections = await tx.classSection.findMany({
        where: { schoolId, ...(opts.gradeId ? { gradeId: opts.gradeId } : {}) },
        select: { id: true, name: true, gradeId: true, grade: { select: { name: true, order: true } } },
      });
      const sectionIds = sections.map((x) => x.id);
      const sectionById = new Map(sections.map((x) => [x.id, x]));

      const students = await tx.student.findMany({
        where: {
          schoolId,
          isActive: true,
          classSectionId: { in: sectionIds },
          ...(opts.q
            ? {
                OR: [
                  { firstName: { contains: opts.q, mode: 'insensitive' } },
                  { lastName: { contains: opts.q, mode: 'insensitive' } },
                  { admissionNo: { contains: opts.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        select: {
          id: true, firstName: true, lastName: true, admissionNo: true,
          classSectionId: true, guardianPhone: true,
        },
        orderBy: [{ admissionNo: 'asc' }],
      });
      const studentIds = students.map((x) => x.id);
      if (studentIds.length === 0) {
        return { totals: EMPTY_TOTALS, rows: [], returned: 0, truncated: false };
      }

      const [invoices, allocations, assignments] = await Promise.all([
        tx.feeInvoice.findMany({
          where: {
            schoolId,
            cancelledAt: null,
            studentId: { in: studentIds },
            ...(opts.termId ? { termId: opts.termId } : {}),
          },
          select: {
            id: true, studentId: true, dueDate: true, totalMinor: true,
            // One collectible line is enough to answer "can this bill accrue a
            // late fee": an RTE bill has none. `take: 1` keeps it a join rather
            // than dragging every line back.
            lines: { where: { isCollectible: true }, select: { id: true }, take: 1 },
          },
        }),
        tx.feeAllocation.groupBy({
          by: ['invoiceId'],
          where: { schoolId, invoice: { studentId: { in: studentIds } } },
          _sum: { amountMinor: true },
        }),
        tx.feeAssignment.findMany({
          where: { schoolId, studentId: { in: studentIds } },
          select: { studentId: true, isRte: true },
        }),
      ]);

      const paidByInvoice = new Map(allocations.map((a) => [a.invoiceId, a._sum.amountMinor ?? 0]));
      const rteBy = new Map(assignments.map((a) => [a.studentId, a.isRte]));

      type Agg = {
        billedMinor: number; paidMinor: number; principalDueMinor: number;
        lateFeeMinor: number; daysOverdue: number; invoiceCount: number;
      };
      const agg = new Map<string, Agg>();
      for (const inv of invoices) {
        const a = agg.get(inv.studentId) ?? {
          billedMinor: 0, paidMinor: 0, principalDueMinor: 0, lateFeeMinor: 0, daysOverdue: 0, invoiceCount: 0,
        };
        const paid = paidByInvoice.get(inv.id) ?? 0;
        const outstanding = inv.totalMinor - paid;
        const lateFee = computeLateFee({
          rule,
          dueDate: inv.dueDate,
          asOf: now,
          outstandingMinor: outstanding,
          isCollectible: inv.lines.length > 0,
        });
        a.billedMinor += inv.totalMinor;
        a.paidMinor += paid;
        a.principalDueMinor += Math.max(0, outstanding);
        a.lateFeeMinor += lateFee;
        a.invoiceCount += 1;
        if (outstanding > 0 && inv.dueDate < now) {
          a.daysOverdue = Math.max(
            a.daysOverdue,
            Math.floor((now.getTime() - inv.dueDate.getTime()) / 86_400_000),
          );
        }
        agg.set(inv.studentId, a);
      }

      const all = students.map((st) => {
        const a = agg.get(st.id);
        const section = st.classSectionId ? sectionById.get(st.classSectionId) : undefined;
        const billed = a?.billedMinor ?? 0;
        const paid = a?.paidMinor ?? 0;
        const principal = a?.principalDueMinor ?? 0;
        const lateFee = a?.lateFeeMinor ?? 0;
        const due = principal + lateFee;
        const status: 'NOT_BILLED' | 'PAID' | 'PARTIAL' | 'UNPAID' =
          !a || a.invoiceCount === 0 ? 'NOT_BILLED'
          : due === 0 ? 'PAID'
          : paid > 0 ? 'PARTIAL'
          : 'UNPAID';
        return {
          studentId: st.id,
          name: `${st.firstName} ${st.lastName}`.trim(),
          admissionNo: st.admissionNo,
          className: section ? `${section.grade.name}-${section.name}` : null,
          gradeId: section?.gradeId ?? null,
          gradeOrder: section?.grade.order ?? 0,
          guardianPhone: st.guardianPhone,
          isRte: rteBy.get(st.id) ?? false,
          billedMinor: billed,
          paidMinor: paid,
          principalDueMinor: principal,
          lateFeeMinor: lateFee,
          dueMinor: due,
          daysOverdue: a?.daysOverdue ?? 0,
          invoiceCount: a?.invoiceCount ?? 0,
          status,
        };
      });

      const filtered = all
        .filter((r) => (opts.owingOnly ? r.dueMinor > 0 : true))
        .filter((r) => (opts.overdueOnly ? r.daysOverdue > 0 && r.dueMinor > 0 : true))
        .filter((r) => (opts.minDueMinor ? r.dueMinor >= opts.minDueMinor : true))
        // Most overdue first when narrowed to who owes; otherwise by class then
        // admission number, which is the order a register is kept in.
        .sort((x, y) =>
          opts.owingOnly || opts.overdueOnly
            ? y.daysOverdue - x.daysOverdue || y.dueMinor - x.dueMinor
            : x.gradeOrder - y.gradeOrder || x.admissionNo.localeCompare(y.admissionNo),
        );

      // Totals over the WHOLE filtered set, never summed from the page — a
      // total that changes when you paginate is one nobody trusts again.
      const totals = filtered.reduce(
        (t, r) => ({
          students: t.students + 1,
          owing: t.owing + (r.dueMinor > 0 ? 1 : 0),
          billedMinor: t.billedMinor + r.billedMinor,
          paidMinor: t.paidMinor + r.paidMinor,
          lateFeeMinor: t.lateFeeMinor + r.lateFeeMinor,
          dueMinor: t.dueMinor + r.dueMinor,
        }),
        { ...EMPTY_TOTALS },
      );

      return {
        totals,
        rows: filtered.slice(0, take),
        returned: Math.min(filtered.length, take),
        truncated: filtered.length > take,
      };
    });
  }

  /**
   * ONE RECEIPT, AS A DOCUMENT.
   *
   * Until now a verified payment surfaced to the family as a receipt NUMBER
   * inside a line of text — nothing they could open, save or show to anyone.
   * This is the document behind that number, and web and app render the same
   * payload so the two cannot drift into disagreeing about what was paid.
   *
   * `studentId` is passed by the parent path and omitted by the office path.
   * When present it is an additional WHERE clause rather than a check on the
   * result, so another family's receipt is a 404 and never a row we fetched
   * and then decided not to return.
   *
   * Allocations are read per invoice LINE, which is what lets the receipt say
   * the money cleared Tuition and Transport specifically rather than just
   * naming a bill — the same transparency the bill breakdown gives.
   */
  async receipt(schoolId: string, paymentId: string, studentId?: string) {
    return withTenant(schoolId, async (tx) => {
      const payment = await tx.feePayment.findFirst({
        where: { id: paymentId, schoolId, ...(studentId ? { studentId } : {}) },
        include: {
          receipt: true,
          student: {
            select: {
              firstName: true, lastName: true, admissionNo: true,
              classSection: { select: { name: true, grade: { select: { name: true } } } },
            },
          },
          allocations: {
            include: {
              invoice: { select: { number: true, term: { select: { name: true } } } },
              invoiceLine: { select: { categoryName: true } },
            },
          },
        },
      });
      if (!payment) throw new ApiError('NOT_FOUND', 'Receipt not found', 404);
      // A receipt exists only once the school has accepted the money. Asking
      // for one on a pending or refused claim is a 404, not an empty document:
      // a blank sheet headed "Receipt" is exactly what a family would screenshot
      // as proof of something that never happened.
      if (payment.status !== 'VERIFIED' || !payment.receipt) {
        throw new ApiError('NOT_FOUND', 'No receipt has been issued for this payment.', 404);
      }

      const [school, profile] = await Promise.all([
        tx.school.findFirstOrThrow({ where: { id: schoolId }, select: { name: true } }),
        tx.schoolProfile.findUnique({
          where: { schoolId },
          select: {
            phone: true, email: true, addressLine1: true, addressLine2: true,
            city: true, region: true, postalCode: true,
          },
        }),
      ]);

      const allocatedMinor = payment.allocations.reduce((a, x) => a + x.amountMinor, 0);

      return {
        receiptNumber: payment.receipt.number,
        issuedAt: payment.receipt.issuedAt,
        school: {
          name: school.name,
          addressLines: [
            profile?.addressLine1,
            profile?.addressLine2,
            [profile?.city, profile?.region, profile?.postalCode].filter(Boolean).join(' '),
          ].map((l) => (l ?? '').trim()).filter((l) => l.length > 0),
          phone: profile?.phone ?? null,
          email: profile?.email ?? null,
        },
        student: {
          name: `${payment.student.firstName} ${payment.student.lastName}`.trim(),
          admissionNo: payment.student.admissionNo,
          className: payment.student.classSection
            ? `${payment.student.classSection.grade.name}-${payment.student.classSection.name}`
            : null,
        },
        payment: {
          id: payment.id,
          amountMinor: payment.amountMinor,
          method: payment.method,
          providerRef: payment.providerRef,
          paidOn: payment.paidOn,
          verifiedAt: payment.verifiedAt,
          /** The school's own words. Rendered verbatim as TEXT, never as HTML. */
          ackNote: payment.ackNote,
        },
        /** What the money actually cleared, by fee category. */
        allocations: payment.allocations.map((a) => ({
          invoiceNumber: a.invoice.number,
          termName: a.invoice.term.name,
          categoryName: a.invoiceLine.categoryName,
          amountMinor: a.amountMinor,
        })),
        /**
         * Paid but not yet applied to any bill — an advance, or the remainder
         * of an overpayment. Shown on the receipt rather than quietly dropped,
         * so the amounts on the page add up to the amount received.
         */
        unallocatedMinor: payment.amountMinor - allocatedMinor,
      };
    });
  }
}
