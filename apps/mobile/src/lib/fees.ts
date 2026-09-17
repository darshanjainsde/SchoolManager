/**
 * The fee portal's wire shapes — `/me/fees/*` — mirrored from
 * apps/web/lib/fees.ts so both clients read the same fields. Amounts are
 * paise (`…Minor`); see lib/money.ts for the only place they become rupees.
 */

export type FeePaymentStatus = 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'REVERSED';
export type FeePaymentMethod =
  | 'UPI' | 'NEFT_IMPS' | 'CHEQUE' | 'CASH' | 'CARD' | 'NETBANKING' | 'OTHER';

export const METHOD_LABEL: Record<FeePaymentMethod, string> = {
  UPI: 'UPI',
  NEFT_IMPS: 'NEFT / IMPS',
  CHEQUE: 'Cheque',
  CASH: 'Cash at office',
  CARD: 'Card',
  NETBANKING: 'Net banking',
  OTHER: 'Other',
};

/** The parent's word for each state — the web portal's, kept identical. */
export const STATUS_LABEL: Record<FeePaymentStatus, string> = {
  SUBMITTED: 'Being checked',
  VERIFIED: 'Confirmed',
  REJECTED: 'Not accepted',
  REVERSED: 'Reversed',
};

export const STATUS_TONE: Record<FeePaymentStatus, 'amber' | 'green' | 'red' | 'neutral'> = {
  SUBMITTED: 'amber',
  VERIFIED: 'green',
  REJECTED: 'red',
  REVERSED: 'neutral',
};

export interface FeeLine {
  categoryName: string;
  categoryDescription: string;
  grossMinor: number;
  concessionMinor: number;
  netMinor: number;
  concessionReason: string | null;
  isCollectible: boolean;
}

export interface FeeInvoice {
  id: string;
  number: string;
  termName: string;
  dueDate: string;
  totalMinor: number;
  paidMinor: number;
  /** Owed on the bill itself, before any late fee. */
  principalDueMinor: number;
  lateFeeMinor: number;
  /** What the family has to send today — principal plus late fee. */
  dueMinor: number;
  isPaid: boolean;
  isOverdue: boolean;
  lines: FeeLine[];
}

export interface FeePaymentRow {
  id: string;
  status: FeePaymentStatus;
  method: FeePaymentMethod;
  amountMinor: number;
  providerRef: string | null;
  paidOn: string;
  submittedAt: string;
  verifiedAt: string | null;
  rejectionReason: string | null;
  receiptNumber: string | null;
}

/** `GET /me/fees`. */
export type ScheduleStatus = 'PAID' | 'PART_PAID' | 'DUE' | 'OVERDUE' | 'UPCOMING';

/** One term of the session — what it costs this child and where it stands. */
export interface ScheduleTerm {
  termId: string;
  name: string;
  dueDate: string;
  /** The bill's total where billed; the plan's figure for this child where not. */
  expectedMinor: number;
  paidMinor: number;
  dueMinor: number;
  status: ScheduleStatus;
  invoiceId: string | null;
  receiptNumber: string | null;
  lines: FeeLine[];
}

/** `GET /me/fees/receipts/:paymentId` — one confirmed payment as a document. */
export interface FeeReceipt {
  number: string;
  issuedAt: string;
  amountMinor: number;
  method: FeePaymentMethod;
  providerRef: string | null;
  paidOn: string;
  verifiedAt: string | null;
  termName: string | null;
  invoiceNumber: string | null;
  student: { name: string; admissionNo: string; className: string | null };
  school: { name: string };
}

export interface StudentFees {
  student: { id: string; name: string; admissionNo: string; className: string | null };
  /** The facts the office quotes when a family rings. */
  account: { admissionNo: string; className: string | null; admittedOn: string | null; isRte: boolean };
  year: { id: string; name: string; startDate: string; endDate: string } | null;
  /** True once the school has a fee plan this child's class is on — false is "not set up yet", not "free". */
  planReady: boolean;
  schedule: ScheduleTerm[];
  nextDue: { termId: string; name: string; dueDate: string; amountMinor: number; billed: boolean; invoiceId: string | null; status: ScheduleStatus } | null;
  yearTotalMinor: number;
  yearPaidMinor: number;
  concessions: { reason: string; scope: string; percentBps: number | null; amountMinor: number | null }[];
  /** Positive means owed. Negative is an advance credit sitting with the school. */
  balanceMinor: number;
  billedMinor: number;
  paidMinor: number;
  /** One line of plain English, or null when the school charges no late fee. */
  lateFeeRule: string | null;
  invoices: FeeInvoice[];
  payments: FeePaymentRow[];
  ledger: { kind: 'DEBIT' | 'CREDIT'; amountMinor: number; narration: string; occurredAt: string }[];
}

/** `GET /me/fees/how-to-pay`. */
export interface HowToPay {
  options: {
    key: string; displayName: string; kind: 'MANUAL' | 'GATEWAY'; blurb: string;
    available: boolean; enabled: boolean; status: string;
  }[];
  canPayOnline: boolean;
  canPayByTransfer: boolean;
}

/** `GET /me/fees/bank-instructions?invoiceId=`. */
export interface BankInstructions {
  kind: 'INSTRUCTIONS';
  bank: {
    accountName: string; accountNumber: string; ifsc: string; bankName: string;
    branch: string | null; upiId: string | null; upiQrUrl: string | null;
    /** `upi://pay?…` with the amount filled in — the one thing a phone can open directly. */
    upiIntentUri: string | null; instructions: string | null;
  };
}

/** The whole-account figure the Fees tab leads with. */
export function totalDueMinor(d: Pick<StudentFees, 'invoices'>): number {
  return d.invoices.filter((i) => !i.isPaid).reduce((n, i) => n + i.dueMinor, 0);
}

/** The bill whose due date is nearest, among those still owed. */
export function nextDue(d: Pick<StudentFees, 'invoices'>): FeeInvoice | null {
  const open = d.invoices.filter((i) => !i.isPaid);
  return open.length ? open.reduce((a, b) => (a.dueDate <= b.dueDate ? a : b)) : null;
}
