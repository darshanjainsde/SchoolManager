import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { StorageService } from '../../../common/storage/storage.service';
import type {
  PaymentContext,
  PaymentProvider,
  PaymentStartResult,
  ProviderStatus,
} from './payment-provider.types';

/**
 * The rail that collects real money today: the parent transfers to the
 * school's own account and tells the school they did; a human verifies it.
 *
 * There is no integration to fail here, which is the point — a school can
 * collect from day one, while its KYC with a gateway is still pending, and a
 * school that never wants a gateway is never blocked.
 *
 * `start()` returns instructions rather than a redirect. Everything after
 * that — the claim, the proof, the verification, the receipt — is
 * `FeePaymentService`'s job and is identical no matter which provider ran.
 */
@Injectable()
export class ManualBankTransferProvider implements PaymentProvider {
  readonly key = 'MANUAL';
  readonly displayName = 'Bank transfer';
  readonly kind = 'MANUAL' as const;
  readonly blurb =
    'Parents transfer to your school account by UPI, NEFT or IMPS and send you the reference. Your office confirms it.';

  /**
   * Empty on purpose. The bank account is not provider config — it is
   * `SchoolBankDetail`, a first-class record with its own screen, because it
   * is shown to parents rather than used to sign an API call.
   */
  readonly configFields = [] as const;

  constructor(private readonly storage: StorageService) {}

  /** Always. There is nothing to onboard. */
  isAvailable(): boolean {
    return true;
  }

  resolveStatus(_config: Record<string, unknown>, enabled: boolean): ProviderStatus {
    return enabled ? 'ACTIVE' : 'NOT_CONFIGURED';
  }

  async start(ctx: PaymentContext): Promise<PaymentStartResult> {
    const bank = await withTenant(ctx.schoolId, (tx) =>
      tx.schoolBankDetail.findFirst({ where: { schoolId: ctx.schoolId } }),
    );

    if (!bank || !bank.isVisible) {
      throw new ApiError(
        'NO_PAYMENT_METHOD',
        'This school has not published its bank details yet. Please contact the school office.',
        409,
      );
    }

    return {
      kind: 'INSTRUCTIONS',
      bank: {
        accountName: bank.accountName,
        accountNumber: bank.accountNumber,
        ifsc: bank.ifsc,
        bankName: bank.bankName,
        branch: bank.branch,
        upiId: bank.upiId,
        upiQrUrl: bank.upiQrKey ? await this.storage.presignedGet(bank.upiQrKey) : null,
        // A deep link WITH the amount in it. The uploaded static QR carries no
        // amount, which is the single commonest cause of an underpayment on
        // this rail — where we can pre-fill it, we do.
        upiIntentUri: bank.upiId
          ? buildUpiIntent(bank.upiId, bank.accountName, ctx.amountMinor, ctx.admissionNo)
          : null,
        instructions: bank.instructions,
      },
    };
  }
}

/**
 * A UPI deep link per the NPCI intent spec. `am` is in RUPEES with two
 * decimals — the one place in this module where an amount is not in paise,
 * because that is what the spec requires.
 */
export function buildUpiIntent(
  upiId: string,
  payeeName: string,
  amountMinor: number,
  note: string,
): string {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    am: (amountMinor / 100).toFixed(2),
    cu: 'INR',
    tn: note,
  });
  return `upi://pay?${params.toString()}`;
}
