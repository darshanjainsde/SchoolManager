/**
 * Pure display math for the Library tab — the RN twin of the web portal's
 * ribbon/chip logic. Dependency-free so it unit-tests against fixed values.
 * Everything here derives from server-computed fields (`daysLeft`,
 * `loanDays`, rupee amounts) — the app never re-computes a due date or a
 * fine; the server's answer is the answer, on web and app alike.
 */

export type DueTone = 'green' | 'amber' | 'red';

/** Green with time in hand, amber inside 3 days, red once overdue. */
export function dueTone(daysLeft: number): DueTone {
  if (daysLeft < 0) return 'red';
  return daysLeft <= 3 ? 'amber' : 'green';
}

/**
 * The bookmark ribbon's length as a fraction of the card (8%–86%): full when
 * freshly issued, draining as the due date nears, a stub once overdue.
 */
export function ribbonPct(daysLeft: number, loanDays: number): number {
  const pct = Math.round((86 * daysLeft) / Math.max(1, loanDays));
  return Math.max(8, Math.min(86, pct));
}

/** The chip's words — colour never carries the message alone. */
export function dueChipLabel(daysLeft: number, dueOnISO: string, accruedFineRupees: number): string {
  if (daysLeft < 0) {
    const late = -daysLeft;
    const fine = accruedFineRupees > 0 ? ` · ${rupees(accruedFineRupees)} so far` : '';
    return `${late} day${late === 1 ? '' : 's'} late${fine}`;
  }
  if (daysLeft === 0) return 'due today!';
  if (daysLeft <= 3) return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left — due ${fmtDay(dueOnISO)}`;
  return `${daysLeft} days left`;
}

/** '2026-08-30' → '30 Aug'. Split by hand so the device timezone can't shift the day. */
export function fmtDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function rupees(n: number): string {
  return `₹${n.toLocaleString('en-IN')}`;
}
