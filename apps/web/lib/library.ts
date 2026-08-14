/**
 * The library, as a student or teacher sees it.
 *
 * Shapes transcribed from `apps/api/src/modules/library/internal/
 * library-me.service.ts` — read from that file, not recalled. A client type
 * written from memory of a shape is the single most-repeated mistake in this
 * project's ledger.
 */

export interface MyBook {
  issueId: string;
  title: string;
  /** The number written inside the front cover. "Book number" at the counter. */
  accessionNumber: string;
  backBy: string;
  /** Negative means late. Never re-derived in the UI — the API decides. */
  daysLeft: number;
  renewCount: number;
}

export interface MyLibrary {
  books: MyBook[];
  /** Absent, not zero, when nothing is owed. */
  owed?: number;
  isMember: boolean;
}

export interface ShelfResult {
  titleId: string;
  title: string;
  author: string | null;
  availableCopies: number;
  totalCopies: number;
}

export interface ClassNotReturned {
  name: string;
  title: string;
  daysLate: number;
}

export type BookTone = 'calm' | 'soon' | 'late';

/**
 * How a book's remaining time reads.
 *
 * The thresholds live here rather than in a component so the student and
 * teacher screens cannot drift into disagreeing about what "soon" means.
 */
export function toneFor(daysLeft: number): BookTone {
  if (daysLeft < 0) return 'late';
  if (daysLeft <= 2) return 'soon';
  return 'calm';
}

/**
 * The state text on a book row.
 *
 * NEVER returns a bare "Late". `Late` is already a standalone attendance chip
 * in four screens of this product, where it means "arrived late to class" — a
 * child seeing it on a library row would reasonably read it as a mark against
 * their attendance. The count is what disambiguates, so the number is always
 * attached: `6 days late`, never `Late`.
 */
export function stateLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const late = Math.abs(daysLeft);
    return late === 1 ? '1 day late' : `${late} days late`;
  }
  if (daysLeft === 0) return 'back today';
  return daysLeft === 1 ? '1 day left' : `${daysLeft} days left`;
}

/** `back by 26 Aug` — the plain-words form. Never "due date". */
export function backByLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `back by ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

/**
 * `2 of 3 on the shelf`.
 *
 * Availability is COUNTED by the API from copy status, never stored — a stored
 * count drifts and then nobody knows which number to trust.
 */
export function shelfLabel(available: number, total: number): string {
  if (available === 0) return total === 1 ? 'not on the shelf' : 'all out';
  return `${available} of ${total} on the shelf`;
}

/** ₹ with en-IN grouping. The library is the first real money in this product. */
export function rupees(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
