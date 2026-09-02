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
   * One receipt, as a document the family can open and keep.
   *
   * The student id comes from the JWT and is passed DOWN into the query as a
   * filter, so a receipt belonging to another child is a 404 at the database
   * rather than a row we read and then declined to return.
   */
  async receipt(userId: string, paymentId: string) {
    return this.query.receipt(this.sid(), paymentId, await this.myStudentId(userId));
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
