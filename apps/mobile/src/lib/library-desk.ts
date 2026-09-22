/**
 * THE LIBRARY COUNTER — response shapes of `/library/*` as the counter reads
 * them (mirrors apps/api/src/modules/library/internal/library-circulation,
 * library-catalog, library-fines and library-hall services). Local to the
 * client, like lib/sports-desk.ts.
 */
export type BorrowerKind = 'STUDENT' | 'TEACHER';

export interface BorrowerRef { kind: BorrowerKind; id: string; name: string; code: string | null; className: string | null; classSectionId: string | null }
export interface IssueCard {
  id: string; accessionNo: string; titleId: string; title: string; author: string; borrower: BorrowerRef;
  issuedOn: string; dueOn: string; returnedOn: string | null; wasLost: boolean; accruedFineRupees: number;
}
export interface MemberCard { borrower: BorrowerRef; limit: number; holdings: IssueCard[]; duesRupees: number }
export interface MemberHit { kind: BorrowerKind; id: string; name: string; code: string | null; className: string | null; holding: number }

export interface Dashboard {
  counts: { titles?: number; copies?: number; lost?: number; outNow: number; dueSoon: number; finesCollectedRupees: number; finesDueRupees: number };
  outNow: IssueCard[];
  today: string;
}

export type CopyStatus = 'IN' | 'OUT' | 'LOST' | string;
export interface CopyView { id: string; accessionNo: string; status: CopyStatus; issueId?: string; borrower?: { kind: BorrowerKind; id: string; name: string; code: string | null }; dueOn?: string }
export interface TitleView { id: string; title: string; author: string; shelf: string | null; totalCopies: number; inCopies: number; lostCopies: number; earliestBack: string | null; copies: CopyView[] }

export interface FineEntry {
  id: string; kind: 'FIXED' | 'ACCRUING'; reason: 'LATE' | 'LOST'; amountRupees: number; title: string; accessionNo: string;
  borrower: BorrowerRef & { userId: string | null }; detail: string;
}
export interface FinesView { entries: FineEntry[]; dueRupees: number; collectedRupees: number; finesEnabled?: boolean }

export type HallStatus = 'PRESENT' | 'ABSENT' | 'LATE';
export interface HallToday {
  date: string;
  period: { id: string; label: string; startTime: string; endTime: string } | null;
  hall: { capacityClasses: number; inUse: number; nowClasses: { id: string; className: string }[] };
  section: { id: string; className: string } | null;
  roster: { studentId: string; name: string; rollNo: number | null; status: HallStatus }[];
  teacherRegister: { taken: boolean; takenBy?: string; takenAt?: string } | null;
  savedVisit: { source: string; savedAt: string } | null;
  sections: { id: string; className: string }[];
}

/** Whole rupees everywhere on the counter. */
export const rupees = (r: number) => `₹${r.toLocaleString('en-IN')}`;

/** Calendar days from `today` to `dueOn`; negative once late. */
export function daysLeft(dueOn: string, today: string): number {
  return Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function dueWord(dueOn: string, today: string): { text: string; tone: 'red' | 'amber' | 'neutral' } {
  const d = daysLeft(dueOn, today);
  if (d < 0) return { text: `${-d} day${d === -1 ? '' : 's'} late`, tone: 'red' };
  if (d === 0) return { text: 'Due today', tone: 'amber' };
  if (d <= 3) return { text: `${d} day${d === 1 ? '' : 's'}`, tone: 'amber' };
  return { text: `${d} days`, tone: 'neutral' };
}

/** "RAF-00042 · 7B" or "Teacher" — the second line under a reader's name. */
export function borrowerLine(b: Pick<BorrowerRef, 'kind' | 'code' | 'className'>): string {
  if (b.kind === 'TEACHER') return 'Teacher';
  return [b.code, b.className].filter(Boolean).join(' · ') || 'Student';
}

const NEXT: Record<HallStatus, HallStatus> = { PRESENT: 'ABSENT', ABSENT: 'LATE', LATE: 'PRESENT' };
export const cycleStatus = (s: HallStatus): HallStatus => NEXT[s];
