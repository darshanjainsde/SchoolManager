/**
 * Shapes the Alumni Office screen works in.
 *
 * Kept beside the page rather than in `@skoolos/types` until the alumnus-facing
 * slice needs them too — nothing outside this screen reads them yet, and a
 * shared type with one consumer is a shared type nobody can change safely.
 */

export type AlumniStatus =
  | 'SCHOOL_ADDED'
  | 'INVITED'
  | 'PENDING'
  | 'VERIFIED'
  | 'DECLINED'
  | 'HIDDEN';

export interface AlumniRow {
  id: string;
  firstName: string;
  lastName: string;
  batchYear: number;
  lastClass: string | null;
  admissionNo: string | null;
  city: string | null;
  country: string | null;
  profession: string | null;
  employer: string | null;
  email: string | null;
  phone: string | null;
  status: AlumniStatus;
  trustedForStudents: boolean;
  isBatchCaptain: boolean;
  isMentor: boolean;
  isDeceased: boolean;
  /** Non-null means this row came from "graduate this batch" rather than a claim. */
  studentId: string | null;
  createdAt: string;
}

export interface AlumniListResult {
  rows: AlumniRow[];
  total: number;
  take: number;
  skip: number;
}

export interface AlumniSummary {
  total: number;
  verified: number;
  pendingClaims: number;
  batches: number;
  cities: number;
  openPledges: number;
  openSessions: number;
}

export interface RollCallRow {
  batchYear: number;
  found: number;
  verified: number;
  registerStrength: number;
  /** null when the register strength has never been typed in — the screen says
   *  "strength not recorded" rather than drawing a full bar off no denominator. */
  coverage: number | null;
  fromSckools: boolean;
}

export interface ClaimRow {
  id: string;
  firstName: string;
  lastName: string;
  batchYear: number;
  claimedAdmissionNo: string | null;
  claimedDob: string | null;
  claimedClass: string | null;
  email: string | null;
  phone: string | null;
  proof: string;
  status: 'PENDING' | 'VERIFIED' | 'DECLINED';
  vouchedByAlumniId: string | null;
  declineReason: string | null;
  createdAt: string;
}

export interface GiftItemRow {
  id: string;
  name: string;
  unit: string;
  indicativeCostMinor: number;
  currency: string;
  sizesTracked: boolean;
  isActive: boolean;
  order: number;
}

export interface GiftGroup {
  scopeKind: 'SCHOOL' | 'GRADE' | 'SECTION';
  gradeId?: string;
  classSectionId?: string;
  label: string;
  headcount: number;
}

export interface GiftGroups {
  school: GiftGroup;
  grades: GiftGroup[];
  sections: GiftGroup[];
}

export type GiftStatus =
  | 'PROPOSED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'COUNTERED'
  | 'CANCELLED'
  | 'RECEIVED'
  | 'DISTRIBUTED'
  | 'REPORTED';

export interface PledgeRow {
  id: string;
  donorName: string | null;
  alumni: { firstName: string; lastName: string; batchYear: number } | null;
  giftItem: { name: string; unit: string; sizesTracked: boolean } | null;
  customRequest: string | null;
  scopeKind: 'SCHOOL' | 'GRADE' | 'SECTION';
  headcountAtPledge: number;
  quantity: number;
  mode: 'FUND' | 'SUPPLY';
  amountMinor: number | null;
  currency: string;
  dedicationKind: 'NONE' | 'IN_MEMORY_OF' | 'IN_HONOUR_OF';
  dedicationText: string | null;
  visibility: 'PUBLIC' | 'ALUMNI' | 'ANONYMOUS';
  status: GiftStatus;
  declineReason: string | null;
  counterNote: string | null;
  dueAt: string | null;
  createdAt: string;
  /** Computed server-side by giftShortfall — the screen never re-derives it. */
  received: number;
  short: number;
  surplus: number;
  canDistribute: boolean;
  distributions: { distributedQty: number; absentQty: number; distributedAt: string }[];
}

export type SlotState = 'FREE' | 'HELD' | 'BOOKED' | 'CLOSED' | 'EMPTY';

export interface SlotView {
  periodId: string;
  periodOrder: number;
  periodLabel: string;
  startTime: string;
  endTime: string;
  date: string;
  state: SlotState;
  /** Present ONLY on the office response. The alumnus-facing call never carries
   *  these fields at all — they are not stripped, they are never written. */
  subjectName?: string;
  teacherName?: string;
  subjectId?: string;
  teacherId?: string;
}

export interface SlotsResult {
  classSectionId: string;
  headcount: number;
  slots: SlotView[];
  truncatedTo: number;
}

export type SessionStatus =
  | 'REQUESTED'
  | 'COUNTERED'
  | 'SCHEDULED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'DELIVERED';

export interface SessionRow {
  id: string;
  title: string;
  summary: string | null;
  mode: 'IN_PERSON' | 'ONLINE';
  classSectionId: string;
  headcountAtBooking: number;
  requestedDate: string;
  requestedPeriodId: string;
  counterDate: string | null;
  counterPeriodId: string | null;
  counterNote: string | null;
  counterRound: number;
  scheduledDate: string | null;
  scheduledPeriodId: string | null;
  accompanyingTeacherId: string | null;
  status: SessionStatus;
  declineReason: string | null;
  createdAt: string;
  alumni: {
    firstName: string;
    lastName: string;
    batchYear: number;
    profession: string | null;
    employer: string | null;
    trustedForStudents: boolean;
  } | null;
}

export interface SessionConflicts {
  date: string;
  displaced: {
    subjectId: string | null;
    subjectName: string | null;
    teacherId: string | null;
    teacherName: string | null;
  } | null;
  examsWithinAWeek: { title: string; on: string }[];
  sessionsThisClass: number;
  siblingSections: { label: string; sessions: number }[];
}

export interface SchoolClass {
  id: string;
  name: string;
  grade: { name: string } | null;
  _count: { students: number };
}

export interface TeacherRow {
  id: string;
  firstName: string;
  lastName: string;
}
