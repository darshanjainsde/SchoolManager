import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { TenantContextService } from '../tenancy';
import { FeePaymentService } from './fee-payment.service';
import { FeeQueryService } from './fee-query.service';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import type { SubmitPaymentDto } from './fees.dto';

/**
 * The parent's side.
 *
 * Every method resolves the student from the caller's own JWT and never
 * accepts a student id from the request — the same rule `/me/*` already
 * follows. A parent asking about another child is a 404, not a filtered list.
 */
@Injectable()
export class FeePortalService {
  constructor(
    private readonly query: FeeQueryService,
    private readonly payments: FeePaymentService,
    private readonly providers: PaymentProviderRegistry,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  private async myStudentId(userId: string): Promise<string> {
    const schoolId = this.sid();
    const student = await withTenant(schoolId, (tx) =>
      tx.student.findFirst({ where: { schoolId, userId }, select: { id: true } }),
    );
    if (!student) throw new ApiError('NOT_FOUND', 'No student record is linked to this login.', 404);
    return student.id;
  }

  /** Bills, breakdown, history and balance — the whole fees screen. */
  async myFees(userId: string) {
    return this.query.studentFees(this.sid(), await this.myStudentId(userId));
  }

  /**
   * How this school can be paid, right now.
   *
   * Returns gateways as unavailable rather than omitting them, so the portal
   * can render the Pay Now button disabled with an honest reason instead of
   * silently hiding it — which is what makes the day a gateway goes live a
   * config change rather than a redesign.
   */
  async howToPay(userId: string) {
    const schoolId = this.sid();
    await this.myStudentId(userId);
    const options = await this.payments.paymentOptions(schoolId);
    return {
      options,
      canPayOnline: options.some((o) => o.kind === 'GATEWAY' && o.available && o.enabled),
      canPayByTransfer: options.some((o) => o.key === 'MANUAL' && o.enabled),
    };
  }

  /** Bank details and a UPI deep link, for the amount actually due. */
  async bankInstructions(userId: string, invoiceId?: string) {
    const schoolId = this.sid();
    const studentId = await this.myStudentId(userId);

    const ctx = await withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirstOrThrow({
        where: { id: studentId, schoolId },
        select: { firstName: true, lastName: true, admissionNo: true },
      });
      const school = await tx.school.findFirstOrThrow({ where: { id: schoolId }, select: { name: true } });

      let amountMinor = 0;
      if (invoiceId) {
        const invoice = await tx.feeInvoice.findFirst({
          where: { id: invoiceId, schoolId, studentId },
          include: { allocations: { select: { amountMinor: true } } },
        });
        if (!invoice) throw new ApiError('NOT_FOUND', 'Bill not found', 404);
        const paid = invoice.allocations.reduce((a, x) => a + x.amountMinor, 0);
        amountMinor = invoice.totalMinor - paid;
      }

      return {
        schoolId,
        studentId,
        invoiceId: invoiceId ?? null,
        amountMinor,
        currency: 'INR',
        idempotencyKey: `${invoiceId ?? studentId}:${amountMinor}`,
        studentName: `${student.firstName} ${student.lastName}`.trim(),
        admissionNo: student.admissionNo,
        schoolName: school.name,
      };
    });

    return this.providers.get('MANUAL').start(ctx);
  }

  /**
   * One confirmed payment as a receipt — the document both clients print.
   * Only VERIFIED payments have one; anything else is a 404, never a 403,
   * because a parent asking about a payment that is not theirs is told it
   * does not exist.
   */
  async myReceipt(userId: string, paymentId: string) {
    const schoolId = this.sid();
    const studentId = await this.myStudentId(userId);
    return withTenant(schoolId, async (tx) => {
      const p = await tx.feePayment.findFirst({
        where: { id: paymentId, schoolId, studentId, status: 'VERIFIED' },
        include: {
          receipt: true,
          invoice: { select: { number: true, term: { select: { name: true } } } },
          student: { select: { firstName: true, lastName: true, admissionNo: true, classSection: { select: { name: true, grade: { select: { name: true } } } } } },
        },
      });
      if (!p || !p.receipt) throw new ApiError('NOT_FOUND', 'That receipt was not found.', 404);
      const school = await tx.school.findFirstOrThrow({ where: { id: schoolId }, select: { name: true } });
      return {
        number: p.receipt.number,
        issuedAt: p.receipt.issuedAt.toISOString(),
        amountMinor: p.receipt.amountMinor,
        method: p.method,
        providerRef: p.providerRef,
        paidOn: p.paidOn.toISOString().slice(0, 10),
        verifiedAt: p.verifiedAt ? p.verifiedAt.toISOString() : null,
        termName: p.invoice?.term.name ?? null,
        invoiceNumber: p.invoice?.number ?? null,
        student: {
          name: `${p.student.firstName} ${p.student.lastName}`.trim(),
          admissionNo: p.student.admissionNo,
          className: p.student.classSection ? `${p.student.classSection.grade.name}-${p.student.classSection.name}` : null,
        },
        school: { name: school.name },
      };
    });
  }

  /** "I have paid" — writes a SUBMITTED claim and nothing else. */
  async submit(
    userId: string,
    dto: Omit<SubmitPaymentDto, 'studentId'>,
    proof?: { buffer: Buffer; filename: string; contentType: string },
  ) {
    const studentId = await this.myStudentId(userId);
    return this.payments.submit(this.sid(), userId, { ...dto, studentId }, proof);
  }
}
