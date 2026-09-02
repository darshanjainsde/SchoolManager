export type {
  FeePaymentMethod,
  FeePaymentStatus,
  FeeReceiptAllocation,
  FeeReceiptDocument,
  StudentFeeInvoice,
  StudentFeeInvoiceLine,
  StudentFeePayment,
  StudentFees,
} from '@skoolos/types';

import type { FeePaymentMethod, FeePaymentStatus } from '@skoolos/types';

/**
 * Fees, on the family's phone.
 *
 * The shapes come from `@skoolos/types` — the same declarations the web portal
 * renders — so a field the API stops sending breaks a compile rather than
 * leaving the two clients quietly disagreeing about what a family owes.
 *
 * Money crosses the wire as `amountMinor`: paise, an integer. It becomes
 * rupees exactly once, here, at the render edge. Nothing in a screen divides
 * by 100 by hand; a stray division is how one surface ends up showing a
 * different balance from another.
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

/**
 * Dates are pinned to Asia/Kolkata rather than the device timezone.
 *
 * A due date is a calendar fact decided by the school. A parent travelling
 * with their phone on another clock must not see a bill fall due a day early
 * or a receipt dated the day before it was issued — and the late-fee engine
 * counts days in Asia/Kolkata too, so anything else would put the app and the
 * amount charged into disagreement.
 */
export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

export const METHOD_LABEL: Record<FeePaymentMethod, string> = {
  UPI: 'UPI',
  NEFT_IMPS: 'NEFT / IMPS',
  CHEQUE: 'Cheque',
  CASH: 'Cash at office',
  CARD: 'Card',
  NETBANKING: 'Net banking',
  OTHER: 'Other',
};

/**
 * What a family reads, never the raw enum.
 *
 * "Being checked" rather than "Submitted": the parent did not submit anything
 * to a system, they told the school they had paid, and what they want to know
 * is whether anyone has looked yet.
 */
export const STATUS_LABEL: Record<FeePaymentStatus, string> = {
  SUBMITTED: 'Being checked',
  VERIFIED: 'Confirmed',
  REJECTED: 'Not accepted',
  REVERSED: 'Reversed',
};

export function statusTone(status: FeePaymentStatus): 'green' | 'amber' | 'red' {
  if (status === 'VERIFIED') return 'green';
  if (status === 'SUBMITTED') return 'amber';
  return 'red';
}
