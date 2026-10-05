/**
 * WHICH HALF OF A SCHOOL A TABLE BELONGS TO.
 *
 * A school is four buckets, and each one is saved and restored on its own:
 *
 *   school   who this school is to us — identity, plan, integrations, admin logins
 *   website  the public face — theme, pages, sections, media, Hall of Fame, blog
 *   setup    how the school runs, year after year — structure, roster, rates, catalogue
 *   day      what happened — attendance, fees, marks, diary, messages, pay, logs
 *
 * `school` and `website` are KEPT. `setup` and `day` are the management data:
 * what a sample pack replaces, what "reset management data" empties, and what a
 * daily rollback puts back. The website is built from a school's real details
 * long before its real data exists, so the two must move independently.
 *
 * The line between `setup` and `day`: **setup holds what persists across
 * occasions, day holds what belongs to one occasion.** A fee head persists, an
 * invoice is one month's. A subject persists, an exam is one term's. The
 * library catalogue persists, an issue is one borrowing. A house persists, a
 * meet happens once. When a thing is created fresh each term and dies with it,
 * it is `day` — that way a rollback takes it back together with the rows that
 * reference it.
 *
 * Nothing in the Prisma schema records this, so it is a map — the one place in
 * this engine that is hand-kept rather than read from the schema. Two tests
 * stop that from rotting:
 *   - `buckets.spec.ts` fails when a model with a `schoolId` is missing here,
 *     so a table added next month cannot fall out of a bucket silently;
 *   - the same spec fails when a REQUIRED foreign key points from a lower
 *     bucket to a higher one, which is what makes an independent restore safe.
 */

export type Bucket = 'school' | 'website' | 'setup' | 'day';

/**
 * Low to high. The order is the restore order, and it is what "points down"
 * means: a row may require a row in its own bucket or in a lower one, never in
 * a higher one. That is why emptying `day` can never strand a `setup` row.
 */
export const BUCKETS = ['school', 'website', 'setup', 'day'] as const;

/** Never replaced by a data operation. */
export const KEPT_BUCKETS = ['school', 'website'] as const;

/** The management data: replaced by a sample pack, emptied by a reset. */
export const DATA_BUCKETS = ['setup', 'day'] as const;

export const bucketRank = (b: Bucket): number => BUCKETS.indexOf(b);

/**
 * One bucket per model. A model listed in `SPLITS` appears in two, and the
 * bucket named here is the lower of them (which is the one that orders it).
 */
export const BUCKET_OF: Readonly<Record<string, Bucket>> = {
  /* ── school: identity, plan, integrations, admin logins ────────────────── */
  Domain: 'school',
  FeatureOverride: 'school',
  EmailSettings: 'school',
  WhatsAppSettings: 'school',
  SchoolPaymentConfig: 'school',
  SchoolBankDetail: 'school',
  // Split: admin logins are `school`, everyone else's login is `setup`.
  User: 'school',

  /* ── website: the public face ──────────────────────────────────────────── */
  SchoolProfile: 'website',
  HomepageContent: 'website',
  DesignDraft: 'website',
  SchoolPage: 'website',
  StatItem: 'website',
  SocialLink: 'website',
  MenuItem: 'website',
  MediaAsset: 'website',
  FeaturedStaff: 'website',
  Course: 'website',
  CourseFee: 'website',
  AdmissionStep: 'website',
  AdmissionsSettings: 'website',
  HallOfFameGroup: 'website',
  HallOfFameEntry: 'website',
  HallOfFameSettings: 'website',
  BlogPost: 'website',
  SchoolBlogSelection: 'website',

  /* ── setup: structure that outlives any one term ───────────────────────── */
  AcademicYear: 'setup',
  Grade: 'setup',
  ClassSection: 'setup',
  Subject: 'setup',
  Period: 'setup',
  TimetableSlot: 'setup',
  Room: 'setup',
  /* ── setup: the people on the roll ─────────────────────────────────────── */
  Teacher: 'setup',
  TeacherSubject: 'setup',
  ClassTeacherAssignment: 'setup',
  Staff: 'setup',
  Student: 'setup',
  Alumni: 'setup',
  AlumniBatch: 'setup',
  /* ── setup: rules and rates ────────────────────────────────────────────── */
  Holiday: 'setup',
  LeaveTypeDef: 'setup',
  FeeCategory: 'setup',
  FeeTerm: 'setup',
  FeePlan: 'setup',
  FeePlanItem: 'setup',
  FeeSettings: 'setup',
  PayComponent: 'setup',
  PayGrade: 'setup',
  EmployeePay: 'setup',
  /* ── setup: catalogues ─────────────────────────────────────────────────── */
  LibrarySettings: 'setup',
  LibraryBookTitle: 'setup',
  LibraryBookCopy: 'setup',
  SportsSettings: 'setup',
  House: 'setup',

  /* ── day: attendance and the register ─────────────────────────────────── */
  Attendance: 'day',
  StaffAttendance: 'day',
  Substitution: 'day',
  AttendanceNotice: 'day',
  RegisterChangeRequest: 'day',
  /* ── day: exams and report cards ──────────────────────────────────────── */
  Exam: 'day',
  Result: 'day',
  SeatingPlan: 'day',
  ReportWindow: 'day',
  ReportRemark: 'day',
  ResultNudge: 'day',
  PressIssue: 'day',
  PressCounter: 'day',
  PrintOrder: 'day',
  PrintOrderEvent: 'day',
  /* ── day: classwork and the diary ─────────────────────────────────────── */
  Assignment: 'day',
  AssignmentSeen: 'day',
  ClassNote: 'day',
  ClassTodo: 'day',
  DiaryEntry: 'day',
  DiaryRecipient: 'day',
  DiaryAck: 'day',
  SessionPlan: 'day',
  SessionDecision: 'day',
  /* ── day: fees. The counters belong with the rows they numbered. ───────── */
  FeeAssignment: 'day',
  FeeConcession: 'day',
  FeeInvoice: 'day',
  FeeInvoiceLine: 'day',
  FeePayment: 'day',
  FeeAllocation: 'day',
  FeeLedgerEntry: 'day',
  FeeReceipt: 'day',
  FeeAudit: 'day',
  FeeCounter: 'day',
  /* ── day: the library counter ─────────────────────────────────────────── */
  LibraryIssue: 'day',
  LibraryFine: 'day',
  LibraryHallVisit: 'day',
  LibraryHallMark: 'day',
  /* ── day: sports. A meet happens once; records are earned at meets. ───── */
  SportsTournament: 'day',
  SportsVenue: 'day',
  SportsEvent: 'day',
  SportsEntry: 'day',
  SportsMatch: 'day',
  SportsHeat: 'day',
  SportsMark: 'day',
  SportsRecord: 'day',
  SportsRecordAttempt: 'day',
  HousePoint: 'day',
  /* ── day: pay and leave. A balance is derived from rows that move together. */
  PayRun: 'day',
  Payslip: 'day',
  PayAdjustment: 'day',
  TaxDeclaration: 'day',
  LeaveApplication: 'day',
  LeaveAllocation: 'day',
  /* ── day: messages and notices ────────────────────────────────────────── */
  Notification: 'day',
  NotificationOutbox: 'day',
  MessageThread: 'day',
  Message: 'day',
  Announcement: 'day',
  WhatsAppDelivery: 'day',
  WhatsAppInbound: 'day',
  EmailDelivery: 'day',
  EmailSuppression: 'day',
  PushToken: 'day',
  /* ── day: families and the front desk ─────────────────────────────────── */
  Concern: 'day',
  ConcernComment: 'day',
  Enquiry: 'day',
  EnquiryNote: 'day',
  Event: 'day',
  EventAudienceSchool: 'day',
  EventTicketType: 'day',
  EventRegistration: 'day',
  EventPayment: 'day',
  /* ── day: hiring ──────────────────────────────────────────────────────── */
  JobPost: 'day',
  JobQuestion: 'day',
  JobApplication: 'day',
  /* ── day: alumni claims and gift campaigns (the roll itself is setup) ─── */
  AlumniClaim: 'day',
  AlumniLinkRequest: 'day',
  AlumniAccessToken: 'day',
  GuestSession: 'day',
  GiftItem: 'day',
  GiftPledge: 'day',
  GiftReceipt: 'day',
  GiftAttachment: 'day',
  GiftEvent: 'day',
  GiftDistribution: 'day',
  /* ── day: jobs and the trail ──────────────────────────────────────────── */
  OnboardingImport: 'day',
  AuditLog: 'day',
};

/**
 * A table whose ROWS belong to different buckets.
 *
 * Only one exists, and it is load-bearing: `User` holds every login a school
 * has. Putting them all in `setup` would let a sample load or a reset delete
 * the school's own admin account — locking the school out of a product they
 * are being shown. Putting them all in `school` would leave a demo's teachers
 * and students with no way to sign in, since `Teacher.userId` is optional and
 * would simply be cleared.
 *
 * So the rule is a partition, not two filters: `when` names one side and the
 * other side is its exact negation, which is why no row can land in both
 * buckets or in neither. `User.role` is NOT NULL, so the negation is total.
 */
export interface SplitRule {
  /** SQL predicate over the table's own columns (no alias). */
  readonly when: string;
  /** Bucket for rows where `when` holds. */
  readonly then: Bucket;
  /** Bucket for every other row. */
  readonly otherwise: Bucket;
  /** Why this table is split, for the message a reader needs. */
  readonly because: string;
}

export const SPLITS: Readonly<Record<string, SplitRule>> = {
  // A person's own profile photo is part of the roster, not of the website.
  // `MediaKind.AVATAR` is written by POST /me/photo; every other kind is CMS
  // imagery. Splitting the table is what lets a sample pack carry its
  // students' faces while leaving the school's logo and hero alone — and it
  // drives the FILE list too, since a bucket's files are exactly its own
  // MediaAsset rows.
  MediaAsset: {
    when: `"kind" = 'AVATAR'`,
    then: 'setup',
    otherwise: 'website',
    because:
      'a profile photo belongs to the person on the roster, while every other picture belongs to the website',
  },
  User: {
    when: `"role" IN ('OWNER', 'SCHOOL_ADMIN')`,
    then: 'school',
    otherwise: 'setup',
    because:
      "a school's own admin login must survive a sample load and a reset, while teacher, student, staff and alumnus logins travel with the roster they belong to",
  },
};

/** Every bucket a model's rows can land in. One, or two when it is split. */
export function bucketsOfModel(model: string): Bucket[] {
  const split = SPLITS[model];
  if (split) return [split.then, split.otherwise];
  const b = BUCKET_OF[model];
  return b ? [b] : [];
}

/**
 * The HIGHEST bucket a model's rows can be in. This is what the "points down"
 * invariant is checked against: a row is only safe to keep when every row it
 * requires is in a bucket that is restored no later than its own.
 */
export function topBucketOfModel(model: string): Bucket | undefined {
  const bs = bucketsOfModel(model);
  if (bs.length === 0) return undefined;
  return bs.reduce((a, b) => (bucketRank(b) > bucketRank(a) ? b : a));
}

/**
 * How to select this model's rows for one bucket:
 *   null → none of its rows are in that bucket
 *   ''   → all of this school's rows
 *   SQL  → the subset matching this predicate
 * The predicate never contains user input; it is written in this file.
 */
export function rowFilter(model: string, bucket: Bucket): string | null {
  const split = SPLITS[model];
  if (split) {
    if (bucket === split.then) return split.when;
    if (bucket === split.otherwise) return `NOT (${split.when})`;
    return null;
  }
  return BUCKET_OF[model] === bucket ? '' : null;
}

/** True when any of this model's rows belong to one of these buckets. */
export const modelInBuckets = (model: string, buckets: readonly Bucket[]): boolean =>
  bucketsOfModel(model).some((b) => buckets.includes(b));
