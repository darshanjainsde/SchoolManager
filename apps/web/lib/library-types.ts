/**
 * The `/me/library` payload — the reader's own shelf, shared by the student
 * portal and the teacher portal Library tabs (and mirrored from
 * apps/api/src/modules/library/internal/library-me.service.ts). Pure types:
 * safe for any test to import.
 */
export interface MeLibraryHolding {
  issueId: string;
  title: string;
  author: string;
  accessionNo: string;
  issuedOn: string;
  dueOn: string;
  /** Negative when overdue. */
  daysLeft: number;
  accruedFineRupees: number;
}

export interface MeLibraryPayload {
  kind: 'STUDENT' | 'TEACHER';
  limit: number;
  loanDays: number;
  finesEnabled: boolean;
  holdings: MeLibraryHolding[];
  history: { issueId: string; title: string; author: string; returnedOn: string; wasLost: boolean }[];
  fines: { id: string; title: string; reason: 'LATE' | 'LOST'; amountRupees: number }[];
  finesDueRupees: number;
  today: string;
}
