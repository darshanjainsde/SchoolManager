import { Injectable } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import type { PayslipDoc, PayslipDocLine } from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * THE PAYSLIP AS A DOCUMENT — built on the server, for everybody.
 *
 * The office and the person get the SAME document, because a payslip is what
 * somebody takes to a bank for a loan and two versions of it is two
 * documents. So this is the only place one is assembled; the console route
 * and the `/me` route differ in nothing but WHO they will build it for.
 *
 * The person's own numbers (PAN, UAN, the bank account) are read from the pay
 * row in force for that month rather than from today's, so reprinting last
 * March's slip does not silently stamp it with an account opened since.
 */
@Injectable()
export class PayslipDocService {
  /** Anybody's, for the console. `SalaryGuard` has already decided the caller may. */
  async forAdmin(schoolId: string, payslipId: string): Promise<PayslipDoc> {
    return withTenant(schoolId, (tx) => this.build(tx, schoolId, payslipId, {}));
  }

  /**
   * The caller's own. Resolved from their user id and narrowed to their own
   * person row, so the id in the URL can never be pointed at somebody else —
   * and only a month the school has LOCKED, which is the same rule the rest
   * of `/me/pay` follows.
   */
  async forSelf(schoolId: string, userId: string, payslipId: string): Promise<PayslipDoc> {
    return withTenant(schoolId, async (tx) => {
      const [teacher, staff] = await Promise.all([
        tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true } }),
        tx.staff.findFirst({ where: { schoolId, userId }, select: { id: true } }),
      ]);
      const mine = teacher
        ? { teacherId: teacher.id }
        : staff ? { staffId: staff.id } : null;
      if (!mine) {
        throw new ApiError('NOT_FOUND', 'Your school record is not linked to this login yet — ask the office.', 404);
      }
      return this.build(tx, schoolId, payslipId, { ...mine, payRun: { status: { in: ['LOCKED', 'PAID'] as const } } });
    });
  }

  private async build(
    tx: TenantTx,
    schoolId: string,
    payslipId: string,
    narrow: Record<string, unknown>,
  ): Promise<PayslipDoc> {
    const slip = await tx.payslip.findFirst({
      where: { id: payslipId, schoolId, ...narrow },
      include: {
        payRun: { select: { periodYear: true, periodMonth: true, status: true, paidAt: true, rulesAsAt: true, packVersion: true } },
      },
    });
    if (!slip) throw new ApiError('NOT_FOUND', 'No payslip for that month.', 404);

    const periodEnd = new Date(Date.UTC(slip.payRun.periodYear, slip.payRun.periodMonth, 0));
    // The pay row IN FORCE for that month, not today's — a reprint of an old
    // slip must not carry numbers the person only has now.
    const pay = await tx.employeePay.findFirst({
      where: {
        schoolId,
        ...(slip.teacherId ? { teacherId: slip.teacherId } : { staffId: slip.staffId }),
        effectiveFrom: { lte: periodEnd },
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { pan: true, uan: true, bankAccount: true, joinedOn: true },
    });

    // Through the TENANT transaction, not the platform client: the school's
    // own name needs no RLS bypass, and every bypass has to be justified on a
    // reviewed list (see common/tenancy-bypass.spec.ts).
    const school = await tx.school.findFirst({ where: { id: schoolId }, select: { name: true } });

    const lines = (Array.isArray(slip.lines) ? slip.lines : []) as unknown as PayslipDocLine[];

    return {
      id: slip.id,
      periodLabel: `${MONTHS[slip.payRun.periodMonth - 1] ?? slip.payRun.periodMonth} ${slip.payRun.periodYear}`,
      periodYear: slip.payRun.periodYear,
      periodMonth: slip.payRun.periodMonth,
      person: {
        name: slip.name,
        designation: slip.designation,
        kind: slip.personKind as 'TEACHER' | 'STAFF',
        pan: pay?.pan ?? null,
        uan: pay?.uan ?? null,
        // NEVER the whole number. A payslip is handed around, photographed
        // and emailed; the last four are enough to recognise the account.
        bankAccountLast4: pay?.bankAccount ? pay.bankAccount.slice(-4) : null,
        joinedOn: pay?.joinedOn ? pay.joinedOn.toISOString() : null,
      },
      lines: lines.map((l) => ({ key: l.key, name: l.name, kind: l.kind, amountMinor: l.amountMinor })),
      daysInMonth: slip.daysInMonth,
      daysPaid: slip.daysPaid,
      lopHalfDays: slip.lopHalfDays ?? 0,
      grossMinor: slip.grossMinor,
      deductionMinor: slip.deductionMinor,
      netMinor: slip.netMinor,
      employerCostMinor: slip.employerCostMinor,
      incomeTaxMinor: slip.incomeTaxMinor,
      taxRegime: slip.taxRegime as 'NEW' | 'OLD',
      ytdGrossMinor: slip.ytdGrossMinor,
      ytdTaxMinor: slip.ytdTaxMinor,
      paidOn: slip.payRun.status === 'PAID' && slip.payRun.paidAt ? slip.payRun.paidAt.toISOString() : null,
      school: { name: school?.name ?? 'Your school' },
      rulesAsAt: slip.payRun.rulesAsAt ? slip.payRun.rulesAsAt.toISOString() : null,
      packVersion: slip.payRun.packVersion ?? null,
    };
  }
}
