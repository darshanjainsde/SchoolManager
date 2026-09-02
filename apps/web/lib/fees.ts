/**
 * Shared fee types and money formatting for the web app.
 *
 * Amounts cross the wire as `amountMinor` — paise, an integer — and are turned
 * into rupees only here, at the very edge. Nothing in a component does
 * `/ 100` by hand; a stray division is how one screen ends up disagreeing with
 * another about what a parent owes.
 */

/** 1240000 → "₹12,400". Indian grouping, paise only when there are any. */
export function rupees(amountMinor: number): string {
  const neg = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / 100);
  const paise = abs % 100;
  const grouped = whole.toLocaleString('en-IN');
  return `${neg ? '−' : ''}₹${paise === 0 ? grouped : `${grouped}.${String(paise).padStart(2, '0')}`}`;
}

/** What the user types ("12,400" or "12400.50") → paise. */
export function toMinor(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  return Math.round(Number(cleaned) * 100);
}

/** Paise → the bare number a grid cell is edited as. */
export function toRupeeInput(amountMinor: number): string {
  return amountMinor === 0 ? '' : String(amountMinor / 100);
}

export function fmtDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

export function fmtDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
  });
}

// ── API shapes ───────────────────────────────────────────────────────────────

export type FeeFrequency = 'PER_TERM' | 'ANNUAL' | 'ONE_TIME';
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

export const FREQUENCY_LABEL: Record<FeeFrequency, string> = {
  PER_TERM: 'every term',
  ANNUAL: 'once a year',
  ONE_TIME: 'one time',
};

export interface FeeCategory {
  id: string;
  name: string;
  description: string;
  frequency: FeeFrequency;
  isOptional: boolean;
  isCollectible: boolean;
  order: number;
}

export type LateFeeMode = 'NONE' | 'FLAT' | 'PER_DAY';

export interface FeeSettings {
  lateFeeMode: LateFeeMode;
  /** Paise. The whole fee for FLAT, the daily rate for PER_DAY. */
  lateFeeAmountMinor: number;
  lateFeeGraceDays: number;
  /** 0 means uncapped. */
  lateFeeCapMinor: number;
}

export interface FeeTerm {
  id: string;
  name: string;
  dueDate: string;
  order: number;
}

export interface GridGrade { id: string; name: string; order: number; studentCount: number }
export interface GridCell { gradeId: string; categoryId: string; termId: string | null; amountMinor: number }

export interface FeeGrid {
  planId: string;
  planVersion: number;
  /** True once bills exist — editing mints a new version rather than rewriting. */
  isFrozen: boolean;
  grades: GridGrade[];
  categories: FeeCategory[];
  terms: FeeTerm[];
  cells: GridCell[];
}

export interface PreviewLine {
  categoryName: string;
  categoryDescription: string;
  grossMinor: number;
  concessionMinor: number;
  netMinor: number;
  concessionReason: string | null;
  isCollectible: boolean;
}

export interface BillingPreview {
  termId: string;
  termName: string;
  students: number;
  toBill: number;
  alreadyBilled: number;
  skippedNoPlan: number;
  rteStudents: number;
  totalMinor: number;
  collectibleMinor: number;
  invoices: {
    studentId: string;
    studentName: string;
    admissionNo: string;
    gradeName: string;
    lines: PreviewLine[];
    totalMinor: number;
    isRte: boolean;
    alreadyBilled: boolean;
  }[];
}

export interface PaymentRow {
  id: string;
  status: FeePaymentStatus;
  method: FeePaymentMethod;
  amountMinor: number;
  providerRef: string | null;
  paidOn: string;
  note: string | null;
  submittedAt: string;
  verifiedAt: string | null;
  rejectionReason: string | null;
  receiptNumber: string | null;
  proofUrl: string | null;
  student: { id: string; name: string; admissionNo: string; className: string | null };
  invoice: {
    id: string; number: string; totalMinor: number; dueDate: string; termName: string;
    /** Late fee accrued as of the day the parent says they paid. */
    lateFeeMinor: number;
    /** Bill total plus that late fee — what the parent was actually quoted. */
    expectedMinor: number;
  } | null;
  /** Pre-computed by the API so the clerk never does arithmetic. */
  amountMatchesBill: boolean | null;
}

export interface CollectionSummary {
  todayByMethod: { method: FeePaymentMethod; amountMinor: number; count: number }[];
  todayTotalMinor: number;
  awaitingReviewMinor: number;
  awaitingReviewCount: number;
  billedMinor: number;
  collectedMinor: number;
  outstandingMinor: number;
}

export interface ProviderField {
  name: string; label: string; scope: 'PLATFORM' | 'SCHOOL';
  secret: boolean; required: boolean; placeholder?: string; help?: string;
  value: string | null; hasValue: boolean;
}

export interface PaymentSetup {
  providers: {
    key: string; displayName: string; blurb: string;
    available: boolean; enabled: boolean;
    status: 'NOT_CONFIGURED' | 'PENDING' | 'ACTIVE' | 'SUSPENDED';
    statusNote: string | null;
    fields: ProviderField[];
  }[];
  bank: {
    accountName: string; accountNumber: string; ifsc: string; bankName: string;
    branch: string | null; upiId: string | null; upiQrUrl: string | null;
    instructions: string | null; isVisible: boolean;
  } | null;
}

export interface StudentFees {
  student: { id: string; name: string; admissionNo: string; className: string | null };
  balanceMinor: number;
  billedMinor: number;
  paidMinor: number;
  /** One line of plain English, or null when the school charges no late fee. */
  lateFeeRule: string | null;
  invoices: {
    id: string; number: string; termName: string; dueDate: string;
    totalMinor: number; paidMinor: number;
    /** Owed on the bill itself, before any late fee. */
    principalDueMinor: number;
    lateFeeMinor: number;
    /** What the parent has to send today — principal plus late fee. */
    dueMinor: number;
    isPaid: boolean; isOverdue: boolean;
    lines: PreviewLine[];
  }[];
  payments: {
    id: string; status: FeePaymentStatus; method: FeePaymentMethod;
    amountMinor: number; providerRef: string | null; paidOn: string;
    submittedAt: string; verifiedAt: string | null;
    rejectionReason: string | null; receiptNumber: string | null;
  }[];
  ledger: { kind: 'DEBIT' | 'CREDIT'; amountMinor: number; narration: string; occurredAt: string }[];
}

export interface HowToPay {
  options: {
    key: string; displayName: string; kind: 'MANUAL' | 'GATEWAY'; blurb: string;
    available: boolean; enabled: boolean; status: string;
  }[];
  canPayOnline: boolean;
  canPayByTransfer: boolean;
}

export interface BankInstructions {
  kind: 'INSTRUCTIONS';
  bank: {
    accountName: string; accountNumber: string; ifsc: string; bankName: string;
    branch: string | null; upiId: string | null; upiQrUrl: string | null;
    upiIntentUri: string | null; instructions: string | null;
  };
}

// ── Fees by student (one list; the defaulters view is a filter on it) ────────

export type StudentFeeStatus = 'NOT_BILLED' | 'PAID' | 'PARTIAL' | 'UNPAID';

export interface StudentFeeRow {
  studentId: string;
  name: string;
  admissionNo: string;
  className: string | null;
  gradeId: string | null;
  gradeOrder: number;
  guardianPhone: string | null;
  isRte: boolean;
  billedMinor: number;
  paidMinor: number;
  /** Owed on the bills themselves, before any late fee. */
  principalDueMinor: number;
  lateFeeMinor: number;
  /** What the family actually owes today — principal plus late fee. */
  dueMinor: number;
  daysOverdue: number;
  invoiceCount: number;
  status: StudentFeeStatus;
}

export interface StudentFeeList {
  /** Over the WHOLE filtered set, never summed from the visible page. */
  totals: {
    students: number; owing: number;
    billedMinor: number; paidMinor: number; lateFeeMinor: number; dueMinor: number;
  };
  rows: StudentFeeRow[];
  returned: number;
  truncated: boolean;
}

export const STATUS_LABEL: Record<StudentFeeStatus, string> = {
  NOT_BILLED: 'Not billed',
  PAID: 'Paid',
  PARTIAL: 'Part paid',
  UNPAID: 'Unpaid',
};

/** Semantic tone, kept off the brand accent so state reads at a glance. */
export const STATUS_TONE: Record<StudentFeeStatus, 'good' | 'warn' | 'bad' | 'neutral'> = {
  NOT_BILLED: 'neutral',
  PAID: 'good',
  PARTIAL: 'warn',
  UNPAID: 'bad',
};

export interface Concession {
  id: string;
  percentBps: number | null;
  amountMinor: number | null;
  reason: string;
  createdAt: string;
  student: { id: string; firstName: string; lastName: string; admissionNo: string };
  category: { id: string; name: string } | null;
  term: { id: string; name: string } | null;
}
