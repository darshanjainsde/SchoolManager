import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { StorageService } from '../../common/storage/storage.service';

/**
 * Read paths for the office screens and the parent portal.
 *
 * Kept separate from the services that write, because the read shapes are
 * driven by what a screen renders rather than by what the domain is — and
 * because these are the queries that have to stay fast at 10,000 students.
 * List screens never fan out per row.
 */
@Injectable()
export class FeeQueryService {
  constructor(private readonly storage: StorageService) {}

  /** The verify desk. Payments awaiting a decision, newest claim first. */
  async paymentsToVerify(schoolId: string, status: 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'REVERSED' = 'SUBMITTED') {
    return withTenant(schoolId, async (tx) => {
      const payments = await tx.feePayment.findMany({
        where: { schoolId, status },
        include: {
          student: {
            select: {
              id: true, firstName: true, lastName: true, admissionNo: true,
              classSection: { select: { name: true, grade: { select: { name: true } } } },
            },
          },
          invoice: { select: { id: true, number: true, totalMinor: true, dueDate: true, term: { select: { name: true } } } },
          receipt: { select: { number: true } },
        },
        orderBy: { submittedAt: 'desc' },
        take: 200,
      });

      // Presigning is per row and unavoidable (each key is different), but it
      // is the ONLY per-row work — everything else came back in one query.
      return Promise.all(
        payments.map(async (p) => ({
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
              }
            : null,
          /**
           * Pre-computed so the clerk is never doing arithmetic. This is what
           * turns "open the screenshot and squint" into a glance.
           */
          amountMatchesBill: p.invoice ? p.invoice.totalMinor === p.amountMinor : null,
        })),
      );
    });
  }

  /** How many are waiting — the badge on the nav item. */
  async pendingCount(schoolId: string) {
    return withTenant(schoolId, async (tx) => ({
      pending: await tx.feePayment.count({ where: { schoolId, status: 'SUBMITTED' } }),
    }));
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

      const [invoices, payments, ledger] = await Promise.all([
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
        invoices: invoices.map((inv) => {
          const allocated = inv.allocations.reduce((a, x) => a + x.amountMinor, 0);
          return {
            id: inv.id,
            number: inv.number,
            termName: inv.term.name,
            dueDate: inv.dueDate,
            totalMinor: inv.totalMinor,
            paidMinor: allocated,
            dueMinor: inv.totalMinor - allocated,
            isPaid: allocated >= inv.totalMinor,
            isOverdue: allocated < inv.totalMinor && inv.dueDate < new Date(),
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
   * The defaulters list. Server-side totals over the whole filtered set, never
   * summed from the visible page — an accountant whose total changes when they
   * paginate stops trusting the number, permanently.
   */
  async defaulters(
    schoolId: string,
    opts: { termId?: string; gradeId?: string; minDueMinor?: number; overdueOnly?: boolean; take?: number; cursor?: string },
  ) {
    return withTenant(schoolId, async (tx) => {
      const invoices = await tx.feeInvoice.findMany({
        where: {
          schoolId,
          cancelledAt: null,
          ...(opts.termId ? { termId: opts.termId } : {}),
          ...(opts.overdueOnly ? { dueDate: { lt: new Date() } } : {}),
        },
        include: {
          allocations: { select: { amountMinor: true } },
          term: { select: { name: true } },
          student: {
            select: {
              id: true, firstName: true, lastName: true, admissionNo: true, guardianPhone: true,
              classSection: { select: { gradeId: true, name: true, grade: { select: { name: true } } } },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
      });

      const rows = invoices
        .map((inv) => {
          const paid = inv.allocations.reduce((a, x) => a + x.amountMinor, 0);
          const due = inv.totalMinor - paid;
          const days = Math.max(
            0,
            Math.floor((Date.now() - inv.dueDate.getTime()) / 86_400_000),
          );
          return {
            invoiceId: inv.id,
            number: inv.number,
            termName: inv.term.name,
            dueDate: inv.dueDate,
            dueMinor: due,
            daysOverdue: due > 0 ? days : 0,
            student: {
              id: inv.student.id,
              name: `${inv.student.firstName} ${inv.student.lastName}`.trim(),
              admissionNo: inv.student.admissionNo,
              guardianPhone: inv.student.guardianPhone,
              gradeId: inv.student.classSection?.gradeId ?? null,
              className: inv.student.classSection
                ? `${inv.student.classSection.grade.name}-${inv.student.classSection.name}`
                : null,
            },
          };
        })
        .filter((r) => r.dueMinor > 0)
        .filter((r) => (opts.gradeId ? r.student.gradeId === opts.gradeId : true))
        .filter((r) => (opts.minDueMinor ? r.dueMinor >= opts.minDueMinor : true));

      return {
        totalStudents: rows.length,
        totalDueMinor: rows.reduce((a, r) => a + r.dueMinor, 0),
        rows: rows.slice(0, opts.take ?? 100),
      };
    });
  }
}
