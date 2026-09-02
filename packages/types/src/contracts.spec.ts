import {
  ATTENDANCE_STATUSES,
  type AttendanceStatusValue,
  type TeacherDayEntry,
  HOLIDAY_TYPES,
  LEAVE_TYPES,
  LEAVE_STATUSES,
  type Announcement,
  type AnnouncementMine,
  type Profile,
  type AttendanceSummary,
  type UpcomingExam,
  type PublishedResult,
  type TimetableSlot,
  type LeaveApplication,
  type Exam,
  type ExamList,
  type SavedResult,
  type SaveResultsResponse,
  type PublishResultsResponse,
  type ClassSectionSummary,
  type Subject,
  type RosterStudent,
  NOTIFICATION_OUTBOX_KINDS,
  type NotificationOutboxKind,
  assertNotificationOutboxKind,
  ASSIGNMENT_ATTACHMENT_KINDS,
  type AssignmentAttachmentKind,
  type Assignment,
  type AssignmentList,
  type StudentAssignment,
  type StudentAssignmentList,
  FEE_PAYMENT_STATUSES,
  FEE_PAYMENT_METHODS,
  type FeePaymentStatus,
  type StudentFees,
  type StudentFeePayment,
  type FeeReceiptDocument,
} from './index';

describe('shared portal contracts', () => {
  it('declares exactly the three attendance states the API accepts', () => {
    expect([...ATTENDANCE_STATUSES].sort()).toEqual(['ABSENT', 'LATE', 'PRESENT']);
  });

  it('AttendanceStatusValue admits every declared status and nothing else', () => {
    const ok: AttendanceStatusValue[] = ['PRESENT', 'ABSENT', 'LATE'];
    expect(ok).toHaveLength(3);
    // @ts-expect-error HALF_DAY is not an attendance state
    const bad: AttendanceStatusValue = 'HALF_DAY';
    expect(bad).toBe('HALF_DAY');
  });

  it('declares exactly the three holiday types the API accepts', () => {
    expect([...HOLIDAY_TYPES].sort()).toEqual(['FESTIVAL', 'PUBLIC', 'SCHOOL']);
  });

  it('a break entry carries no slot and no register', () => {
    const entry: TeacherDayEntry = {
      periodId: 'p', label: 'Lunch', startTime: '11:20', endTime: '12:00',
      kind: 'BREAK', slot: null, register: null,
    };
    expect(entry.slot).toBeNull();
  });

  it('declares exactly the five leave types and four leave statuses the API accepts', () => {
    expect([...LEAVE_TYPES].sort()).toEqual(['CASUAL', 'EARNED', 'OTHER', 'SICK', 'UNPAID']);
    expect([...LEAVE_STATUSES].sort()).toEqual(['APPROVED', 'CANCELLED', 'PENDING', 'REJECTED']);
  });

  it('an Announcement targets either a class or the whole school', () => {
    const wholeSchool: Announcement = {
      id: 'a1', title: 'Founders Day', body: 'No school Friday.', classSectionId: null,
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    const oneClass: Announcement = { ...wholeSchool, classSectionId: 'c1' };
    expect(wholeSchool.classSectionId).toBeNull();
    expect(oneClass.classSectionId).toBe('c1');
  });

  it('an AnnouncementMine row is one-per-target — a singular className, not a plural list', () => {
    const wholeSchool: AnnouncementMine = {
      id: 'a1', title: 'Founders Day', body: 'No school Friday.',
      classSectionId: null, className: null, createdAt: '2026-07-01T00:00:00.000Z',
    };
    const oneClass: AnnouncementMine = { ...wholeSchool, id: 'a2', classSectionId: 'c1', className: '5-A' };
    expect(wholeSchool.className).toBeNull();
    expect(oneClass.className).toBe('5-A');
  });

  it('a student Profile carries a nullable roll number, class name and student code', () => {
    const p: Profile = {
      firstName: 'Asha', lastName: 'Rao', admissionNo: 'A-001', code: null,
      rollNo: null, className: null, photoUrl: null,
    };
    expect(p.rollNo).toBeNull();
    // Code is null until a login exists; once allocated it is AAA-00001-shaped.
    const withCode: Profile = { ...p, code: 'RAF-00042' };
    expect(withCode.code).toMatch(/^[A-Z]{3}-\d{5,}$/);
  });

  it('AttendanceSummary days use the same three-state status as the register', () => {
    const s: AttendanceSummary = {
      month: '2026-07', percent: 50, present: 1, absent: 1, late: 0,
      days: [
        { date: '2026-07-01', status: 'PRESENT' },
        { date: '2026-07-02', status: 'ABSENT' },
      ],
    };
    expect(s.days).toHaveLength(2);
  });

  it('an UpcomingExam and a PublishedResult both carry scheduledAt as an ISO string, not a Date', () => {
    const exam: UpcomingExam = {
      id: 'e1', title: 'Unit test', subjectName: 'Math',
      scheduledAt: '2026-08-01T09:00:00.000Z', maxMarks: 50, syllabus: null,
    };
    const result: PublishedResult = {
      examId: 'e1', title: 'Unit test', subjectName: 'Math',
      scheduledAt: '2026-08-01T09:00:00.000Z', marks: 40, maxMarks: 50, classAverage: 33.3,
    };
    expect(typeof exam.scheduledAt).toBe('string');
    expect(typeof result.scheduledAt).toBe('string');
  });

  it('a TimetableSlot carries the class name composed as "grade-section"', () => {
    const slot: TimetableSlot = {
      id: 's1', dayOfWeek: 1,
      period: { id: 'p1', label: 'Period 1', order: 1, startTime: '08:00', endTime: '08:45' },
      subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
      teacher: { id: 't1', firstName: 'Asha', lastName: 'Rao' },
      classSection: { id: 'c1', name: 'B', grade: { name: '7' } },
    };
    expect(`${slot.classSection.grade.name}-${slot.classSection.name}`).toBe('7-B');
  });

  it('a LeaveApplication admits every declared type and status', () => {
    const leave: LeaveApplication = {
      id: 'l1', type: 'SICK', startDate: '2026-07-20', endDate: '2026-07-22',
      reason: null, status: 'PENDING', createdAt: '2026-07-19T00:00:00.000Z',
    };
    expect(leave.status).toBe('PENDING');
  });

  it('an Exam/ExamList pair splits upcoming from past, each with string dates', () => {
    const exam: Exam = {
      id: 'e1', classSectionId: 'c1', subjectId: 'sub1', title: 'Unit test',
      scheduledAt: '2026-08-01T09:00:00.000Z', syllabus: null, maxMarks: 50,
      createdById: 'u1', createdAt: '2026-07-01T00:00:00.000Z',
    };
    const list: ExamList = { upcoming: [exam], past: [] };
    expect(list.upcoming[0].id).toBe('e1');
  });

  it('a SavedResult is unpublished until publishedAt is set', () => {
    const unpublished: SavedResult = { studentId: 's1', marks: 40, publishedAt: null };
    const published: SavedResult = { ...unpublished, publishedAt: '2026-08-02T10:00:00.000Z' };
    expect(unpublished.publishedAt).toBeNull();
    expect(published.publishedAt).not.toBeNull();
  });

  it('SaveResultsResponse and PublishResultsResponse are each a single count', () => {
    const saved: SaveResultsResponse = { saved: 2 };
    const published: PublishResultsResponse = { published: 2 };
    expect(saved.saved).toBe(2);
    expect(published.published).toBe(2);
  });

  it('a ClassSectionSummary composes "grade-section" and a Subject carries its code', () => {
    const cs: ClassSectionSummary = { id: 'c1', name: 'B', grade: { name: '7' } };
    const subject: Subject = { id: 'sub1', code: 'MATH', name: 'Mathematics' };
    expect(`${cs.grade.name}-${cs.name}`).toBe('7-B');
    expect(subject.code).toBe('MATH');
  });

  it('a RosterStudent never carries guardian PII — only the four roster fields', () => {
    const student: RosterStudent = { id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: null };
    expect(Object.keys(student).sort()).toEqual(['firstName', 'id', 'lastName', 'rollNo']);
  });

  it('declares exactly the NotificationOutbox kinds the API writes', () => {
    expect([...NOTIFICATION_OUTBOX_KINDS].sort()).toEqual([
      'ASSIGNMENT_POSTED',
      'EXAM_SCHEDULED',
      'LIBRARY_NOTICE',
      'MESSAGE_RECEIVED',
      'RESULT_PUBLISHED',
    ]);
  });

  it('assertNotificationOutboxKind narrows a valid string and rejects an invalid one', () => {
    const ok: NotificationOutboxKind[] = ['RESULT_PUBLISHED', 'EXAM_SCHEDULED'];
    expect(ok).toHaveLength(2);

    const value: string = 'RESULT_PUBLISHED';
    assertNotificationOutboxKind(value); // does not throw
    const narrowed: NotificationOutboxKind = value;
    expect(narrowed).toBe('RESULT_PUBLISHED');

    expect(() => assertNotificationOutboxKind('TEST_SCHEDULED')).toThrow(
      'Invalid NotificationOutbox kind: "TEST_SCHEDULED"',
    );
  });

  it('declares exactly the two Assignment attachment kinds — pdf and image, no submission uploads', () => {
    expect([...ASSIGNMENT_ATTACHMENT_KINDS].sort()).toEqual(['image', 'pdf']);
    const k: AssignmentAttachmentKind = 'pdf';
    expect(k).toBe('pdf');
  });

  it('an Assignment carries a seenCount alongside the create fields — the teacher list never needs a second round trip', () => {
    const a: Assignment = {
      id: 'a1',
      classSectionId: 'c1',
      subjectId: 'sub1',
      title: 'Worksheet 3',
      instructions: 'Complete questions 1-10.',
      dueDate: '2026-08-05',
      attachments: [{ url: 'https://x/y.pdf', name: 'worksheet.pdf', kind: 'pdf' }],
      createdByTeacherId: 'u1',
      createdAt: '2026-07-30T00:00:00.000Z',
      seenCount: 4,
    };
    expect(a.seenCount).toBe(4);
    const list: AssignmentList = { upcoming: [a], past: [] };
    expect(list.upcoming).toHaveLength(1);
  });

  it('a StudentAssignment resolves subjectName server-side and carries no seenCount (that is the teacher-only view)', () => {
    const sa: StudentAssignment = {
      id: 'a1',
      subjectId: 'sub1',
      subjectName: 'Mathematics',
      title: 'Worksheet 3',
      instructions: 'Complete questions 1-10.',
      dueDate: '2026-08-05',
      attachments: [],
      createdAt: '2026-07-30T00:00:00.000Z',
    };
    expect(Object.keys(sa)).not.toContain('seenCount');
    const list: StudentAssignmentList = { upcoming: [sa], past: [] };
    expect(list.upcoming[0].subjectName).toBe('Mathematics');
  });

  // ── Fees, the family's side ───────────────────────────────────────────────

  it('declares exactly the four payment states the API can return', () => {
    expect([...FEE_PAYMENT_STATUSES].sort()).toEqual(
      ['REJECTED', 'REVERSED', 'SUBMITTED', 'VERIFIED'],
    );
  });

  it('declares every payment method the submit form offers', () => {
    expect([...FEE_PAYMENT_METHODS].sort()).toEqual(
      ['CARD', 'CASH', 'CHEQUE', 'NEFT_IMPS', 'NETBANKING', 'OTHER', 'UPI'],
    );
  });

  it('FeePaymentStatus admits every declared state and nothing else', () => {
    const verified: FeePaymentStatus = 'VERIFIED';
    expect(FEE_PAYMENT_STATUSES).toContain(verified);
    // @ts-expect-error PAID is not a state this module has — VERIFIED is.
    const bogus: FeePaymentStatus = 'PAID';
    expect(bogus).toBe('PAID');
  });

  it('a verified payment carries the receipt number AND the school\'s note; a rejected one carries neither', () => {
    const verified: StudentFeePayment = {
      id: 'p1',
      status: 'VERIFIED',
      method: 'NEFT_IMPS',
      amountMinor: 1_240_000,
      providerRef: 'N123456789',
      paidOn: '2026-08-28',
      submittedAt: '2026-08-28T06:00:00.000Z',
      verifiedAt: '2026-08-29T04:30:00.000Z',
      rejectionReason: null,
      ackNote: 'Received by NEFT on 28 Aug. Thank you.',
      receiptNumber: 'RCP/2026/00042',
    };
    expect(verified.receiptNumber).toBe('RCP/2026/00042');

    const rejected: StudentFeePayment = {
      ...verified,
      status: 'REJECTED',
      verifiedAt: null,
      ackNote: null,
      receiptNumber: null,
      rejectionReason: 'The UTR does not match any credit on our statement.',
    };
    expect(rejected.receiptNumber).toBeNull();
    expect(rejected.rejectionReason).not.toBeNull();
  });

  it('a bill breaks down to lines whose net is gross minus concession, and dueMinor includes the late fee', () => {
    const fees: StudentFees = {
      student: { id: 's1', name: 'Aarav Sharma', admissionNo: 'A-1024', className: 'VIII-B' },
      balanceMinor: 105_000,
      billedMinor: 1_345_000,
      paidMinor: 1_240_000,
      lateFeeRule: '₹50 per day after 7 days, up to ₹1,000',
      invoices: [{
        id: 'i1',
        number: 'INV/2026/00311',
        termName: 'Term 2',
        dueDate: '2026-08-15',
        totalMinor: 100_000,
        paidMinor: 0,
        principalDueMinor: 100_000,
        lateFeeMinor: 5_000,
        dueMinor: 105_000,
        isPaid: false,
        isOverdue: true,
        lines: [{
          categoryName: 'Tuition',
          categoryDescription: 'Term tuition',
          grossMinor: 120_000,
          concessionMinor: 20_000,
          netMinor: 100_000,
          concessionReason: 'Sibling concession',
          isCollectible: true,
        }],
      }],
      payments: [],
      ledger: [{ kind: 'DEBIT', amountMinor: 100_000, narration: 'Term 2 bill', occurredAt: '2026-08-01T00:00:00.000Z' }],
    };
    // A school charging no late fee sends null, not an empty string — the
    // portal renders the rule line only when there is a rule.
    const noRule: StudentFees = { ...fees, lateFeeRule: null };
    expect(noRule.lateFeeRule).toBeNull();

    const line = fees.invoices[0].lines[0];
    expect(line.grossMinor - line.concessionMinor).toBe(line.netMinor);
    const inv = fees.invoices[0];
    expect(inv.principalDueMinor + inv.lateFeeMinor).toBe(inv.dueMinor);
  });

  it('a receipt accounts for every paisa received: allocations plus unallocated equal the amount', () => {
    const r: FeeReceiptDocument = {
      receiptNumber: 'RCP/2026/00042',
      issuedAt: '2026-08-29T04:30:00.000Z',
      school: {
        name: 'Raffles Public School',
        addressLines: ['12 MG Road', 'Indiranagar', 'Bengaluru Karnataka 560038'],
        phone: '+91 80 4000 1234',
        email: 'office@raffles.test',
      },
      student: { name: 'Aarav Sharma', admissionNo: 'A-1024', className: 'VIII-B' },
      payment: {
        id: 'p1',
        amountMinor: 1_300_000,
        method: 'NEFT_IMPS',
        providerRef: 'N123456789',
        paidOn: '2026-08-28',
        verifiedAt: '2026-08-29T04:30:00.000Z',
        ackNote: 'Received by NEFT on 28 Aug. Thank you.',
      },
      allocations: [
        { invoiceNumber: 'INV/2026/00311', termName: 'Term 2', categoryName: 'Tuition', amountMinor: 1_000_000 },
        { invoiceNumber: 'INV/2026/00311', termName: 'Term 2', categoryName: 'Transport', amountMinor: 240_000 },
      ],
      unallocatedMinor: 60_000,
    };
    const allocated = r.allocations.reduce((a, x) => a + x.amountMinor, 0);
    expect(allocated + r.unallocatedMinor).toBe(r.payment.amountMinor);
  });
});
