/**
 * The payment-provider contract.
 *
 * Deliberately shaped like `NotificationChannel`: a small interface, a DI
 * token holding an array of implementations, and a registry that resolves one
 * by key. A developer who has read `common/notifications` has read this.
 *
 * The point of the abstraction is narrow and worth stating: a provider decides
 * HOW money is taken and WHETHER a claim is genuine. It never decides what
 * that means for the school's books. Writing the ledger, allocating across
 * invoice lines, issuing a receipt and enforcing idempotency all live in
 * `FeePaymentService`, so a new provider cannot get double-entry wrong.
 */

/** Where a declared config field is stored. */
export type ConfigScope =
  /** Held once by Sckools for every school — e.g. PhonePe's OAuth client id. */
  | 'PLATFORM'
  /** Held per school — e.g. that school's own merchant id. */
  | 'SCHOOL';

/**
 * A provider describes its own configuration, and the admin screen renders
 * from this description. That is what makes adding a provider a one-file
 * change: nobody hand-writes a form per gateway.
 */
export interface ProviderConfigField {
  name: string;
  label: string;
  scope: ConfigScope;
  /** Encrypted at rest, write-only in the UI, never returned by the API. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
}

/** What the school sees as a status pill, and what gates the Pay Now button. */
export type ProviderStatus = 'NOT_CONFIGURED' | 'PENDING' | 'ACTIVE' | 'SUSPENDED';

/** Everything a provider needs to start a payment. Built server-side, always. */
export interface PaymentContext {
  schoolId: string;
  studentId: string;
  invoiceId: string | null;
  /**
   * The amount to collect, in paise, computed from the invoice by the service.
   * A provider must never be handed a figure that came from a client.
   */
  amountMinor: number;
  currency: string;
  /** Stable per (invoice, amount, client nonce) so a retry is not a second order. */
  idempotencyKey: string;
  studentName: string;
  admissionNo: string;
  schoolName: string;
}

/**
 * What `start()` hands back to the client. A manual provider returns
 * instructions; a gateway returns something to redirect to. The union is
 * closed so the portal can render both without knowing which provider ran.
 */
export type PaymentStartResult =
  | {
      kind: 'INSTRUCTIONS';
      /** Bank details and a UPI link the parent acts on themselves. */
      bank: {
        accountName: string;
        accountNumber: string;
        ifsc: string;
        bankName: string;
        branch: string | null;
        upiId: string | null;
        upiQrUrl: string | null;
        upiIntentUri: string | null;
        instructions: string | null;
      };
    }
  | {
      kind: 'REDIRECT';
      /** Gateway-hosted checkout. */
      url: string;
      providerRef: string;
    };

/** The canonical result of resolving a payment, whoever resolved it. */
export interface PaymentOutcome {
  status: 'VERIFIED' | 'REJECTED';
  /** UTR, UPI reference or gateway payment id. */
  providerRef: string | null;
  /** What actually arrived, which is not always what was asked for. */
  amountMinor: number;
  /** Shown to the parent verbatim when REJECTED, so it must be actionable. */
  reason?: string;
}

export interface PaymentProvider {
  /** Matches `FeePayment.provider` and `SchoolPaymentConfig.provider`. */
  readonly key: string;
  readonly displayName: string;
  readonly kind: 'MANUAL' | 'GATEWAY';
  /** One line the admin screen shows under the provider's name. */
  readonly blurb: string;
  readonly configFields: readonly ProviderConfigField[];

  /**
   * False until Sckools' own onboarding with this provider is complete. This
   * is what renders the Pay Now button disabled rather than hidden — see the
   * blueprint's note on why it ships visible.
   */
  isAvailable(): boolean;

  /** Whether THIS school has finished configuring it. */
  resolveStatus(config: Record<string, unknown>, enabled: boolean): ProviderStatus;

  start(ctx: PaymentContext): Promise<PaymentStartResult>;
}

/** Thrown when a gateway is reached before Sckools has onboarded with it. */
export class ProviderUnavailableError extends Error {
  constructor(key: string) {
    super(`Payment provider ${key} is not available yet`);
  }
}
