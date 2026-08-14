/**
 * The counter, as the API describes it.
 *
 * Shapes transcribed from `apps/api/src/modules/library/internal/
 * library-desk.service.ts` — read from that file, not recalled. A client type
 * written from memory of a shape is the most-repeated mistake in this
 * project's ledger, and it fails in the worst way: the code compiles, the
 * screen renders, and one field is quietly always undefined.
 */

export interface MemberCard {
  memberId: string;
  /** The borrower number in the register — the school's own student code where there is one. */
  code: string;
  name: string;
  classRef: string | null;
  memberType: string;
  booksOut: number;
  /** Absent, not zero, when nothing is owed. */
  owed?: number;
}

export interface CopyCard {
  copyId: string;
  accessionNumber: string;
  title: string;
  author: string | null;
  status: string;
  /** Null when the book is on the shelf. */
  out: {
    issueId: string;
    memberId: string;
    memberName: string;
    classRef: string | null;
    backBy: string;
    /** Negative means late. The API decides; the UI never re-derives it. */
    daysLeft: number;
  } | null;
}

export interface NotReturnedRow {
  issueId: string;
  memberName: string;
  classRef: string | null;
  title: string;
  accessionNumber: string;
  daysLate: number;
}

export interface DeskDayRow {
  issueId: string;
  kind: 'ISSUED' | 'RETURNED';
  at: string;
  memberName: string;
  title: string;
  accessionNumber: string;
}

/** `GET /manage/library/status` — `library-org.service.ts#statusFor`. */
export interface LibraryStatus {
  provisioned: boolean;
  /** Provisioned AND at least one book. What the student/teacher nav gate reads. */
  live: boolean;
  members: number;
  copies: number;
}

/** `POST /manage/library/enrol` — `library-enrolment.service.ts`. */
export interface EnrolmentReport {
  enrolled: number;
  alreadyMembers: number;
  /** People with no Sckools login yet; they cannot be linked. */
  skippedNoLogin: number;
}

/**
 * `6-B · 2 books · no. S-2291` — what identifies a child at a counter.
 *
 * Class first because that is how a librarian disambiguates two Aaravs, and
 * the borrower number last because she only needs it when the register is
 * open in front of her.
 */
export function memberLine(m: MemberCard): string {
  const bits = [m.classRef, m.booksOut === 1 ? '1 book' : `${m.booksOut} books`, `no. ${m.code}`];
  return bits.filter(Boolean).join(' · ');
}

/** `9 days late` / `back by 28 Aug`. Never a bare "Late" — see lib/library.ts. */
export function copyStateLabel(out: CopyCard['out']): string {
  if (!out) return 'on the shelf';
  if (out.daysLeft < 0) {
    const late = Math.abs(out.daysLeft);
    return late === 1 ? '1 day late' : `${late} days late`;
  }
  const d = new Date(out.backBy);
  if (Number.isNaN(d.getTime())) return 'out';
  return `back by ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

/** `10:42 am` — the time a counter event happened, in the reader's own clock. */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
