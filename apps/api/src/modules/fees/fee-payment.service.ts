import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { isP2002 } from '../../common/errors/prisma-errors';
import { StorageService } from '../../common/storage/storage.service';
import { computeLateFee, ruleFromSettings } from './late-fee';
import { PaymentProviderRegistry } from './providers/payment-provider.registry';
import type { RejectPaymentDto, SubmitPaymentDto } from './fees.dto';

/**
 * Everything that happens to money after a provider has done its part.
 *
 * The division of labour is the whole point of the abstraction: a provider
 * decides HOW money is taken and whether a claim is genuine; this service
 * decides what that means for the school's books. Ledger writes, allocation,
 * receipt numbering and idempotency all live here, so a new gateway cannot
 * introduce a double-entry bug.
 */

@Injectable()
export class FeePaymentService {
  private readonly logger = new Logger(FeePaymentService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  // ── Parent side ───────────────────────────────────────────────────────────

  /**
   * A parent (or a clerk recording cash) claims a payment.
   *
   * Writes a SUBMITTED row and nothing else — no ledger entry, no receipt.
   * Money only becomes real when a human verifies it, which is the entire
   * safety property of this rail.
   */
  async submit(
    schoolId: string,
    submittedBy: string | null,
    dto: SubmitPaymentDto,
    proof?: { buffer: Buffer; filename: string; contentType: string },
  ) {
    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: dto.studentId, schoolId },
        select: { id: true },
      });
      if (!student) throw new ApiError('NOT_FOUND', 'Student not found', 404);

      if (dto.invoiceId) {
        const invoice = await tx.feeInvoice.findFirst({
          where: { id: dto.invoiceId, schoolId, studentId: dto.studentId },
        });
        if (!invoice) throw new ApiError('NOT_FOUND', 'Bill not found', 404);
      }

      let proofKey: string | null = null;
      if (proof) {
        const up = await this.storage.upload(
          `schools/${schoolId}/fee-proofs`,
          proof.filename,
          proof.buffer,
          proof.contentType,
          // Private bucket: a bank screenshot carries an account number and a
          // payer's name. Read back through presignedGet, which this path
          // already does — so nothing else changes.
          { private: true },
        );
        proofKey = up.key;
      }

      try {
        return await tx.feePayment.create({
          data: {
            schoolId,
            studentId: dto.studentId,
            invoiceId: dto.invoiceId ?? null,
            provider: 'MANUAL',
            providerRef: dto.reference?.trim() || null,
            method: dto.method,
            amountMinor: dto.amountMinor,
            paidOn: new Date(dto.paidOn),
            proofKey,
            note: dto.note ?? null,
            submittedBy,
            status: 'SUBMITTED',
          },
        });
      } catch (e) {
        // The partial unique index on (schoolId, provider, providerRef) is the
        // duplicate guard — both parents submitting the same UTR, or one
        // parent double-tapping, collide here rather than producing two claims
        // the office has to spot by eye.
        if (isP2002(e)) {
          throw new ApiError(
            'DUPLICATE_PAYMENT_REFERENCE',
            'That payment reference has already been sent to the school. If you think this is wrong, please contact the office.',
            409,
          );
        }
        throw e;
      }
    });
  }

  // ── Office side ───────────────────────────────────────────────────────────

  /**
   * Accept a claimed payment. One transaction does all five things, so a crash
   * part-way cannot leave money half-recorded:
   *
   *   1. the payment becomes VERIFIED
   *   2. a CREDIT lands in the append-only ledger
   *   3. the amount is allocated across the bill's lines
   *   4. a receipt number is drawn from the per-school sequence
   *   5. an audit row is chained onto the previous one
   *
   * The notification is deliberately NOT in here — see `verifyAndNotify`.
   */
  async verify(schoolId: string, actorId: string, paymentId: string) {
    return withTenant(schoolId, async (tx) => {
      const payment = await tx.feePayment.findFirst({
        where: { id: paymentId, schoolId },
        include: { invoice: { include: { lines: { orderBy: { order: 'asc' } } } } },
      });
      if (!payment) throw new ApiError('NOT_FOUND', 'Payment not found', 404);
      if (payment.status !== 'SUBMITTED') {
        throw new ApiError(
          'PAYMENT_NOT_PENDING',
          `This payment is already ${payment.status.toLowerCase()}.`,
          409,
        );
      }

      const updated = await tx.feePayment.update({
        where: { id: paymentId },
        data: { status: 'VERIFIED', verifiedBy: actorId, verifiedAt: new Date() },
      });

      // Charge any late fee BEFORE the payment credit, so the balance nets out
      // the way the parent was shown it. Accrual is computed as of the day the
      // parent says they paid — not today — so a bill that sat three weeks on
      // the verify desk does not cost them three more weeks of late fee.
      if (payment.invoice) {
        await this.chargeLateFee(tx, schoolId, payment.studentId, payment.invoice, payment.paidOn);
      }

      await tx.feeLedgerEntry.create({
        data: {
          schoolId,
          studentId: payment.studentId,
          kind: 'CREDIT',
          amountMinor: payment.amountMinor,
          refType: 'PAYMENT',
          refId: payment.id,
          narration: `Payment received — ${payment.method}${payment.providerRef ? ` · ${payment.providerRef}` : ''}`,
        },
      });

      if (payment.invoice) {
        await this.allocate(tx, schoolId, payment.id, payment.invoice, payment.amountMinor);
      }

      const year = new Date().getFullYear();
      const series = `RCP/${year}`;
      const [{ fee_next_number: seq }] = await tx.$queryRaw<{ fee_next_number: number }[]>`
        SELECT fee_next_number(${schoolId}::uuid, ${series}::text)
      `;
      const receipt = await tx.feeReceipt.create({
        data: {
          schoolId,
          paymentId: payment.id,
          studentId: payment.studentId,
          number: `${series}/${String(seq).padStart(5, '0')}`,
          amountMinor: payment.amountMinor,
        },
      });

      await this.audit(tx, schoolId, actorId, 'PAYMENT_VERIFIED', 'FeePayment', payment.id, {
        status: payment.status,
      }, { status: 'VERIFIED', receipt: receipt.number });

      this.logger.log({ schoolId, paymentId, receipt: receipt.number }, 'fee payment verified');
      return { payment: updated, receipt };
    });
  }

  /**
   * Turn a claim down. The reason is shown to the parent verbatim, which is
   * why the DTO constrains it to a short list plus an optional note — a
   * rejection has to be actionable, not just negative.
   */
  async reject(schoolId: string, actorId: string, paymentId: string, dto: RejectPaymentDto) {
    return withTenant(schoolId, async (tx) => {
      const payment = await tx.feePayment.findFirst({ where: { id: paymentId, schoolId } });
      if (!payment) throw new ApiError('NOT_FOUND', 'Payment not found', 404);
      if (payment.status !== 'SUBMITTED') {
        throw new ApiError(
          'PAYMENT_NOT_PENDING',
          `This payment is already ${payment.status.toLowerCase()}.`,
          409,
        );
      }

      const updated = await tx.feePayment.update({
        where: { id: paymentId },
        data: {
          status: 'REJECTED',
          verifiedBy: actorId,
          verifiedAt: new Date(),
          rejectionReason: dto.reason,
        },
      });

      await this.audit(tx, schoolId, actorId, 'PAYMENT_REJECTED', 'FeePayment', payment.id,
        { status: payment.status }, { status: 'REJECTED', reason: dto.reason });

      return updated;
    });
  }

  /**
   * Undo a verification — a bounced cheque, a payment matched to the wrong
   * child, a duplicate found later.
   *
   * The original CREDIT stays in the ledger and an opposing DEBIT is posted.
   * That is not pedantry: the ledger is append-only at the database level
   * (a trigger raises on UPDATE and DELETE), so a reversal is the only
   * mechanism there is, and the history stays readable.
   */
  async reverse(schoolId: string, actorId: string, paymentId: string, reason: string) {
    return withTenant(schoolId, async (tx) => {
      const payment = await tx.feePayment.findFirst({ where: { id: paymentId, schoolId } });
      if (!payment) throw new ApiError('NOT_FOUND', 'Payment not found', 404);
      if (payment.status !== 'VERIFIED') {
        throw new ApiError('PAYMENT_NOT_PENDING', 'Only a verified payment can be reversed.', 409);
      }

      const updated = await tx.feePayment.update({
        where: { id: paymentId },
        data: { status: 'REVERSED', reversedAt: new Date(), reversedReason: reason },
      });

      await tx.feeLedgerEntry.create({
        data: {
          schoolId,
          studentId: payment.studentId,
          kind: 'DEBIT',
          amountMinor: payment.amountMinor,
          refType: 'REVERSAL',
          refId: payment.id,
          narration: `Payment reversed — ${reason}`,
        },
      });

      await tx.feeAllocation.deleteMany({ where: { schoolId, paymentId } });

      await this.audit(tx, schoolId, actorId, 'PAYMENT_REVERSED', 'FeePayment', payment.id,
        { status: 'VERIFIED' }, { status: 'REVERSED', reason });

      return updated;
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Post the late fee this bill has accrued, if any is still unposted.
   *
   * Idempotent by construction: it reads what has already been charged against
   * this invoice and posts only the difference. Verifying a second payment on
   * the same bill therefore adds nothing, and a part payment followed weeks
   * later by the balance charges the extra days once, not twice.
   *
   * A DEBIT rather than a new invoice line, because an issued invoice is
   * immutable — the parent has seen it. The ledger is where anything that
   * happens *after* issue belongs.
   */
  private async chargeLateFee(
    tx: TenantTx,
    schoolId: string,
    studentId: string,
    invoice: { id: string; dueDate: Date; totalMinor: number; lines: { isCollectible: boolean }[] },
    asOf: Date,
  ): Promise<number> {
    const settings = await tx.feeSettings.findUnique({ where: { schoolId } });
    const rule = ruleFromSettings(
      settings ?? { lateFeeMode: 'NONE', lateFeeAmountMinor: 0, lateFeeGraceDays: 0, lateFeeCapMinor: 0 },
    );
    if (rule.mode === 'NONE') return 0;

    const [allocated, alreadyCharged] = await Promise.all([
      tx.feeAllocation.aggregate({
        where: { schoolId, invoiceId: invoice.id },
        _sum: { amountMinor: true },
      }),
      tx.feeLedgerEntry.aggregate({
        where: { schoolId, refType: 'LATE_FEE', refId: invoice.id },
        _sum: { amountMinor: true },
      }),
    ]);

    const outstanding = invoice.totalMinor - (allocated._sum.amountMinor ?? 0);
    const accrued = computeLateFee({
      rule,
      dueDate: invoice.dueDate,
      asOf,
      outstandingMinor: outstanding,
      isCollectible: invoice.lines.some((l) => l.isCollectible),
    });

    const delta = accrued - (alreadyCharged._sum.amountMinor ?? 0);
    if (delta <= 0) return 0;

    await tx.feeLedgerEntry.create({
      data: {
        schoolId,
        studentId,
        kind: 'DEBIT',
        amountMinor: delta,
        refType: 'LATE_FEE',
        refId: invoice.id,
        narration: `Late fee — paid after ${invoice.dueDate.toISOString().slice(0, 10)}`,
        occurredAt: asOf,
      },
    });
    return delta;
  }

  /**
   * Spread a payment across the bill's lines.
   *
   * Oldest-first by line order, taking what each line still owes, so a part
   * payment clears whole lines rather than leaving every line fractionally
   * paid. Any remainder after every line is settled is an OVERPAYMENT and is
   * deliberately left unallocated — it shows on the ledger as a credit
   * balance the office can refund or carry forward, never silently absorbed.
   */
  private async allocate(
    tx: TenantTx,
    schoolId: string,
    paymentId: string,
    invoice: { id: string; lines: { id: string; netMinor: number }[] },
    amountMinor: number,
  ) {
    const priorByLine = new Map<string, number>();
    const prior = await tx.feeAllocation.groupBy({
      by: ['invoiceLineId'],
      where: { schoolId, invoiceId: invoice.id },
      _sum: { amountMinor: true },
    });
    for (const p of prior) priorByLine.set(p.invoiceLineId, p._sum.amountMinor ?? 0);

    let remaining = amountMinor;
    const rows: { schoolId: string; paymentId: string; invoiceId: string; invoiceLineId: string; amountMinor: number }[] = [];

    for (const line of invoice.lines) {
      if (remaining <= 0) break;
      const owed = line.netMinor - (priorByLine.get(line.id) ?? 0);
      if (owed <= 0) continue;
      const take = Math.min(owed, remaining);
      rows.push({ schoolId, paymentId, invoiceId: invoice.id, invoiceLineId: line.id, amountMinor: take });
      remaining -= take;
    }

    if (rows.length) await tx.feeAllocation.createMany({ data: rows });
    if (remaining > 0) {
      this.logger.log(
        { schoolId, paymentId, overpaidMinor: remaining },
        'payment exceeds the bill — surplus left as a credit balance',
      );
    }
    return { allocated: amountMinor - remaining, surplus: remaining };
  }

  /**
   * Append a hash-chained audit row. `prevHash` is the previous row's hash for
   * this school, so a deleted or edited row breaks the chain and is detectable
   * rather than merely discouraged.
   */
  private async audit(
    tx: TenantTx,
    schoolId: string,
    actorId: string | null,
    action: string,
    refType: string,
    refId: string,
    before: unknown,
    after: unknown,
  ) {
    const prev = await tx.feeAudit.findFirst({
      where: { schoolId },
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });
    const payload = JSON.stringify({ schoolId, actorId, action, refType, refId, before, after });
    const hash = createHash('sha256')
      .update(`${prev?.hash ?? ''}|${payload}`)
      .digest('hex');

    return tx.feeAudit.create({
      data: {
        schoolId,
        actorId,
        action,
        refType,
        refId,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
        prevHash: prev?.hash ?? null,
        hash,
      },
    });
  }

  /** Which providers this school could collect through, and their state. */
  async paymentOptions(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [configs, bank] = await Promise.all([
        tx.schoolPaymentConfig.findMany({ where: { schoolId } }),
        tx.schoolBankDetail.findFirst({ where: { schoolId } }),
      ]);
      const byKey = new Map(configs.map((c) => [c.provider, c]));

      return this.providers.all().map((p) => {
        const cfg = byKey.get(p.key);
        const config = (cfg?.config as Record<string, unknown>) ?? {};
        const enabled = p.key === 'MANUAL' ? Boolean(bank?.isVisible) : Boolean(cfg?.enabled);
        return {
          key: p.key,
          displayName: p.displayName,
          kind: p.kind,
          blurb: p.blurb,
          available: p.isAvailable(),
          status: p.resolveStatus(config, enabled),
          enabled,
        };
      });
    });
  }
}
