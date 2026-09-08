# Data model (packages/db/prisma/schema.prisma)

_Generated 2026-09-08 from `9be058c` (staging-site-preview → origin/staging). Do not edit by hand — run the sckools-expert-update skill._

120 models, 56 enums. "RLS" is whether any migration enabled row-level security on the table; a tenant table with **no** is filtered by application code only.

## Models

| Model | Tenant (schoolId) | RLS | Fields | Relations | Unique | Doc |
| --- | --- | --- | --- | --- | --- | --- |
| School | no | yes | 114 | Domain, EmailSettings, FeatureOverride, User, AuditLog, SchoolProfile, HomepageContent, StatItem, SocialLink, MenuItem, MediaAsset, FeaturedStaff, AcademicYear, Grade, ClassSection, Subject, Teacher, Student, Period, TimetableSlot, Event, Enquiry, Announcement, Course, CourseFee, AdmissionStep, AdmissionsSettings, HallOfFameEntry, HallOfFameGroup, HallOfFameSettings, Attendance, Substitution, Staff, StaffAttendance, LeaveApplication, LeaveTypeDef, LeaveAllocation, PushToken, Holiday, BlogPost, SchoolBlogSelection, Notification, ClassNote, ClassTodo, RegisterChangeRequest, NotificationOutbox, Assignment, MessageThread, Message, DiaryEntry, AttendanceNotice, JobPost, LibrarySettings, DesignDraft, SchoolPage, LibraryBookTitle, LibraryBookCopy, LibraryIssue, LibraryFine, LibraryHallVisit, LibraryHallMark, Result, AssignmentSeen, Room, SeatingPlan, Alumni, AlumniBatch, AlumniClaim, GiftItem, GiftPledge, GiftAttachment, GiftEvent, GiftReceipt, GiftDistribution, GuestSession, AlumniAccessToken, AlumniLinkRequest, FeeCategory, FeeTerm, FeePlan, FeePlanItem, FeeAssignment, FeeConcession, FeeInvoice, FeeInvoiceLine, FeePayment, FeeAllocation, FeeLedgerEntry, FeeReceipt, SchoolPaymentConfig, SchoolBankDetail, FeeAudit, FeeCounter, FeeSettings, PressIssue, PrintOrder, ResultNudge, PrintOrderEvent, PressCounter, ReportWindow, ReportRemark |  |  |
| Domain | yes | yes | 8 | School |  |  |
| EmailSettings | yes | yes | 21 | School |  | A school's letterhead and (optionally) its own outbound sender. Every field is nullable and the row itself is optional: a school with no row |
| FeatureOverride | yes | yes | 5 | School | [schoolId, featureKey] |  |
| User | yes | yes | 16 | School, RefreshToken, PasswordResetToken, ImpersonationToken | [schoolId, email] ; [schoolId, username] |  |
| RefreshToken | yes | yes | 10 | User |  |  |
| PushToken | yes | yes | 9 | School |  | One registered Expo push device per row, keyed by `token` (Expo issues a new token per app-install, so upsert-by-token is how a re-registeri |
| Holiday | yes | yes | 8 | School |  | A school-configured holiday/closure shown on both mobile portals' read-only `/me/holidays` calendar. `type` is a plain String rather than a  |
| AuditLog | yes | yes | 9 | School |  |  |
| SchoolProfile | yes | yes | 54 | School |  |  |
| HomepageContent | yes | yes | 16 | School |  |  |
| DesignDraft | yes | yes | 9 | School |  | A saved website look — the design subset of SchoolProfile as one JSON blob. "Preview" renders it client-side without touching the live site; |
| SchoolPage | yes | yes | 11 | School | [schoolId, slug] | An admin-built extra page (Transport, Scholarships, Alumni…): typed content blocks, never raw HTML. The slug is FROZEN at creation like nav  |
| StatItem | yes | yes | 6 | School |  |  |
| SocialLink | yes | yes | 6 | School |  |  |
| MenuItem | yes | yes | 11 | School, MenuItem | [schoolId, slug] |  |
| MediaAsset | yes | yes | 12 | School |  |  |
| FeaturedStaff | yes | yes | 9 | School, Teacher |  |  |
| Course | yes | yes | 13 | School, CourseFee, HallOfFameGroup |  |  |
| CourseFee | yes | yes | 8 | School, Course |  |  |
| AdmissionStep | yes | yes | 6 | School |  |  |
| AdmissionsSettings | yes | yes | 5 | School |  |  |
| HallOfFameGroup | yes | yes | 11 | School, Course, HallOfFameEntry |  |  |
| HallOfFameEntry | yes | yes | 12 | School, HallOfFameGroup, Student | [groupId, batchYear, rank] | One podium place for one group in one batch year. Batches never replace each other: (group, year, rank) is the key, so Batch of 2022 keeps i |
| HallOfFameSettings | yes | yes | 4 | School |  | Which batch the public section lands on (null = latest with entries) and how many earlier batches it lists. |
| AcademicYear | yes | yes | 13 | School, ClassSection, TimetableSlot, LeaveAllocation, FeeTerm, FeePlan, ReportWindow | [schoolId, name] |  |
| Grade | yes | yes | 7 | School, ClassSection, FeePlanItem | [schoolId, name] |  |
| ClassSection | yes | yes | 20 | School, Grade, AcademicYear, Teacher, Student, TimetableSlot, Announcement, ClassNote, ClassTodo, RegisterChangeRequest, NotificationOutbox, Assignment, MessageThread, DiaryEntry | [schoolId, gradeId, name, academicYearId] |  |
| Subject | yes | yes | 12 | School, TeacherSubject, TimetableSlot, ClassNote, ClassTodo, Assignment, MessageThread, DiaryEntry | [schoolId, code] |  |
| Teacher | yes | yes | 18 | School, TeacherSubject, ClassSection, TimetableSlot, FeaturedStaff, MessageThread, LibraryIssue |  |  |
| TeacherSubject | yes | yes | 6 | Teacher, Subject | [teacherId, subjectId] |  |
| Student | yes | yes | 43 | School, ClassSection, Attendance, Result, AssignmentSeen, MessageThread, DiaryRecipient, DiaryAck, AttendanceNotice, LibraryIssue, FeeAssignment, FeeConcession, FeeInvoice, FeePayment, FeeLedgerEntry, PressIssue, ReportRemark, HallOfFameEntry | [schoolId, admissionNo] ; [schoolId, code] |  |
| Period | yes | yes | 9 | School, TimetableSlot | [schoolId, order] |  |
| TimetableSlot | yes | yes | 16 | School, ClassSection, Period, Subject, Teacher, AcademicYear | [schoolId, classSectionId, dayOfWeek, periodId, academicYearId, effectiveFrom], name: "class_slot" ; [schoolId, teacherId, dayOfWeek, periodId, academicYearId, effectiveFrom], name: "teacher_slot" |  |
| Attendance | yes | yes | 10 | School, Student | [studentId, date], name: "one_mark_per_student_day" |  |
| Substitution | yes | yes | 10 | School | [classSectionId, periodId, date], name: "one_sub_per_slot_date" |  |
| Staff | yes | yes | 12 | School |  |  |
| StaffAttendance | yes | yes | 9 | School | [teacherId, date], name: "one_teacher_mark_per_day" ; [staffId, date], name: "one_staff_mark_per_day" |  |
| LeaveApplication | yes | yes | 14 | School, LeaveTypeDef |  |  |
| LeaveTypeDef | yes | yes | 12 | School, LeaveAllocation, LeaveApplication | [schoolId, name] ; [schoolId, builtin] | A school's own leave vocabulary — quota and carry-forward policy live here. Seeded from the five built-in `LeaveType` values the first time  |
| LeaveAllocation | yes | yes | 12 | School, LeaveTypeDef, AcademicYear | [schoolId, teacherId, typeDefId, academicYearId] | One teacher's grant of one leave type for one academic year. `used` is deliberately NOT a column — it is derived from APPROVED applications  |
| Exam | yes | yes | 11 | Result |  |  |
| Result | yes | yes | 10 | School, Exam, Student | [examId, studentId], name: "one_result_per_exam_student" | `schoolId` is carried DIRECTLY rather than derived through `examId -> Exam.schoolId`, which is how this table's RLS policy used to establish |
| NotificationOutbox | yes | yes | 13 | School, ClassSection |  | Transactional outbox for "families' phones get told" events (S6/S7 wiring, Portal Parity R3 Phase 4 Task 2). `ExamsService.create()`/`publis |
| Assignment | yes | yes | 14 | School, ClassSection, Subject, AssignmentSeen |  | A teacher-posted assignment for one class section (T21, Portal Parity R3 Phase 4 Task 4). `attachments` is a denormalised JSON array of `{ u |
| AssignmentSeen | yes | yes | 8 | School, Assignment, Student | [assignmentId, studentId], name: "one_seen_per_assignment_student" | A student's "seen/opened" mark for an `Assignment` — v1's ONLY tracking signal (see `Assignment`'s docstring: no submission uploads yet). `A |
| MessageThread | yes | yes | 14 | School, Student, Teacher, Subject, ClassSection, Message | [studentId, teacherId, subjectId], name: "one_thread_per_student_teacher_subject" |  |
| Message | yes | yes | 9 | School, MessageThread |  |  |
| Notification | yes | yes | 12 | School |  | In-app notification inbox — the per-user, per-event rows behind the bell in both portals (unread count + notification list). DISTINCT from ` |
| Room | yes | yes | 11 | School, SeatingPlan | [schoolId, name] | A physical room, described only as far as seating needs it: how many rows of desks, how many desks in a row, and how many students share one |
| SeatingPlan | yes | yes | 14 | School, Room |  | One generated seating chart for one room. `seats` is the whole plan as JSON, not a row per student. A plan is written once by the generator  |
| Event | yes | yes | 24 | School, EventTicketType, EventRegistration, EventAudienceSchool |  |  |
| EventAudienceSchool | yes | yes | 3 | Event |  | One explicitly-invited school, when audienceKind = SELECTED. |
| EventTicketType | yes | yes | 12 | Event, EventRegistration |  | A thing you can register for. An event has one or many; a free event has a single type priced at zero rather than no type at all, so every e |
| EventRegistration | yes | yes | 21 | Event, EventTicketType, EventPayment | [eventId, studentId] | One person's place at one event. It lives in the HOST school's tenant — `schoolId` is the host, and that is what RLS scopes on. The host own |
| EventPayment | yes | yes | 12 | EventRegistration |  | Money that changed hands. Written today by an admin recording cash at the office (`provider = "MANUAL"`), and by a gateway later — the same  |
| PasswordResetToken | no | yes | 7 | User |  |  |
| Enquiry | yes | yes | 14 | School, EnquiryNote |  |  |
| EnquiryNote | yes | yes | 9 | Enquiry |  | One line of an enquiry's history: a note somebody typed, or a stage change. Append-only by convention — nothing in the app updates or delete |
| Announcement | yes | yes | 9 | School, ClassSection |  |  |
| MarketingLead | no | yes | 13 | LeadActivity |  |  |
| LeadActivity | no | yes | 9 | MarketingLead |  | Append-only timeline for one lead: notes, logged contact attempts and the stage moves between them. Never updated — corrections are new rows |
| MarketingConfig | no | yes | 10 |  |  | Singleton (id = "default"): owner-editable pricing + public contact info. |
| ImpersonationToken | yes | yes | 9 | User |  | One-time 15-minute owner→school-admin login handoff (sha256 at rest, single-use, host-bound at exchange time). Mirrors PasswordResetToken. |
| BlogPost | yes | yes | 18 | School, SchoolBlogSelection | [schoolId, slug] |  |
| SchoolBlogSelection | yes | yes | 8 | School, BlogPost | [schoolId, postId] |  |
| ClassNote | yes | yes | 11 | School, ClassSection, Subject |  | A teacher's running notes about one class on one day. Scoped to the class and the date, not to the teacher, so a co-teacher of the same sect |
| ClassTodo | yes | yes | 12 | School, ClassSection, Subject |  | A tickable task a teacher sets for one class on one day. |
| RegisterChangeRequest | yes | yes | 13 | School, ClassSection |  | A request to reopen a past day's register. Registers lock at the end of their own day; an APPROVED request re-opens exactly one (class, date |
| DiaryEntry | yes | yes | 16 | School, ClassSection, Subject, DiaryRecipient, DiaryAck |  |  |
| DiaryRecipient | yes | yes | 6 | DiaryEntry, Student | [entryId, studentId], name: "one_recipient_per_entry_student" | Who a SELECTED entry is addressed to. Absent entirely for `audience: ALL` (a whole-class entry stores no per-student rows — a 60-child class |
| DiaryAck | yes | yes | 9 | DiaryEntry, Student | [entryId, studentId], name: "one_ack_per_entry_student" | Read receipt + parent signature, written LAZILY: a row appears the first time that child's diary renders the entry, and gains `signedAt`/`si |
| AttendanceNotice | yes | yes | 10 | School, Student |  | A receipt for the attendance bar's one-tap "tell these families" action. Exists to enforce the cooldown (a family is never nagged twice in t |
| JobPost | yes | yes | 22 | School, JobQuestion, JobApplication |  |  |
| JobQuestion | yes | yes | 10 | JobPost |  |  |
| JobApplication | yes | yes | 12 | JobPost |  | THE MOST SENSITIVE DATA THIS PRODUCT STORES: a private individual's name, phone and CV link, submitted by somebody with no account. It belon |
| LibrarySettings | yes | yes | 14 | School |  | One row per school, created on first read with the approved defaults. The librarian edits it from the portal gear; the school admin edits th |
| LibraryBookTitle | yes | yes | 9 | School, LibraryBookCopy |  |  |
| LibraryBookCopy | yes | yes | 9 | School, LibraryBookTitle, LibraryIssue | [schoolId, accessionNo] |  |
| LibraryIssue | yes | yes | 17 | School, LibraryBookCopy, Student, Teacher, LibraryFine |  | One loan. Exactly one of studentId/teacherId is set (the StaffAttendance XOR convention). An open loan is returnedOn = NULL — a partial uniq |
| LibraryFine | yes | yes | 13 | School, LibraryIssue |  | A crystallized amount owed — created at return time (LATE) or write-off (LOST), never while the book is still out. "Collect later" is simply |
| LibraryHallVisit | yes | yes | 10 | School, LibraryHallMark | [schoolId, classSectionId, date] | A class's library-period attendance, saved by the librarian — either confirmed from the class teacher's register (SYNCED) or taken fresh (RE |
| LibraryHallMark | yes | yes | 7 | School, LibraryHallVisit | [visitId, studentId] |  |
| Alumni | yes | yes | 35 | School, GiftPledge, GuestSession, AlumniAccessToken, AlumniLinkRequest | [schoolId, studentId] | A former student. One row per person per school. |
| AlumniBatch | yes | yes | 8 | School | [schoolId, batchYear] | The denominator Roll Call needs. The SIS knows how many alumni it created; only the bound register knows how many were in the room in 1998. |
| AlumniClaim | yes | yes | 19 | School |  | A public self-registration awaiting a human. The JobApplication shape: an application row plus a review queue, deliberately NOT an Alumni ro |
| GiftItem | yes | yes | 12 | School, GiftPledge | [schoolId, name] | The school's own wish list. Written by the school, never by us and never by a donor — the worst outcome this module can produce is three hun |
| GiftPledge | yes | yes | 46 | School, Alumni, GiftItem, GiftReceipt, GiftDistribution, GiftAttachment, GiftEvent |  | One gift, from proposal to report. A gift is not a payment — it is a small supply chain, and every state carries a date. |
| GiftReceipt | yes | yes | 9 | School, GiftPledge |  | What actually arrived. Pledged and received are two different numbers and both get written down — 38 promised, 36 delivered is a real and co |
| GiftAttachment | yes | yes | 11 | School, GiftPledge |  | The handing out. `absentQty` exists because the school already knows the 38 children, so "two absent, collected Monday" is a fact and not an |
| GiftEvent | yes | yes | 10 | School, GiftPledge |  | One line of a pledge's history. The pledge carries its CURRENT status; this carries how it got there, and it is what the donor actually read |
| GiftDistribution | yes | yes | 11 | School, GiftPledge |  |  |
| GuestSession | yes | yes | 31 | School, Alumni |  | A lecture or skill session an alumnus gives to a class. The only feature in Homecoming that puts an adult in a room with children, which is  |
| AlumniAccessToken | yes | yes | 10 | School, Alumni |  | The alumnus's credential. There is no password. An alumnus touches this product perhaps three times a year, and nobody remembers a password  |
| AlumniLinkRequest | yes | yes | 9 | School, Alumni |  | "I am already registered — send me my link." A row exists ONLY when the contact matched a verified alumnus. A non-match writes nothing at al |
| MetricRollup | no | yes | 8 |  |  | One hour of traffic for one route, promoted out of Redis. Redis holds only the live minutes — it is a buffer, not a store, and its keys expi |
| FeeCategory | yes | yes | 15 | School, FeePlanItem, FeeConcession, FeeInvoiceLine | [schoolId, name] | What a category is for, in the school's own words — and, critically, in the words the PARENT reads on their bill. `description` is not docum |
| FeeTerm | yes | yes | 13 | School, AcademicYear, FeePlanItem, FeeInvoice, FeeConcession | [schoolId, academicYearId, name] | One instalment of a session. Due dates live here, so "when is Term 2 due" has exactly one answer for the whole school. |
| FeePlan | yes | yes | 12 | School, AcademicYear, FeePlanItem, FeeAssignment, FeeInvoice | [schoolId, academicYearId, version] | A version of the whole fee structure for one session. Editing amounts after bills exist mints a NEW version; issued invoices keep pointing a |
| FeePlanItem | yes | yes | 12 | School, FeePlan, Grade, FeeCategory, FeeTerm | [planId, gradeId, categoryId, termId] | One cell of the admin's grid: this grade pays this much for this category, in this term. `termId` null means "same in every term" — which is |
| FeeAssignment | yes | yes | 11 | School, Student, FeePlan | [studentId, planId] | Which plan version a student is billed from, and which optional categories they have opted into. Without this row a student is billed their  |
| FeeConcession | yes | yes | 15 | School, Student, FeeCategory, FeeTerm |  | A discount for one student. Always rendered on the bill as its own named line — a parent who cannot see the concession does not know they go |
| FeeInvoice | yes | yes | 18 | School, Student, FeeTerm, FeePlan, FeeInvoiceLine, FeeAllocation, FeePayment | [studentId, termId] ; [schoolId, number] | A bill. IMMUTABLE once issued — the parent has seen it. `number` is a gap-free per-school sequence allocated inside the issuing transaction. |
| FeeInvoiceLine | yes | yes | 16 | School, FeeInvoice, FeeCategory, FeeAllocation |  | One line of a bill. Gross, concession and net are all stored so the parent sees what was charged AND what was waived, and so a report can to |
| FeePayment | yes | yes | 25 | School, Student, FeeInvoice, FeeAllocation, FeeReceipt |  | Money that changed hands — whoever moved it. Written today by a parent claiming a bank transfer (`provider = 'MANUAL'`, status SUBMITTED) an |
| FeeAllocation | yes | yes | 10 | School, FeePayment, FeeInvoice, FeeInvoiceLine |  | Which lines of which bill a payment actually paid. Written by the allocation waterfall when a payment is verified, so partial payments, adva |
| FeeLedgerEntry | yes | yes | 12 | School, Student |  | THE TRUTH. Append-only: no row is ever updated or deleted, and a balance is SUM over this table and nowhere else. Every other fee table is a |
| FeeReceipt | yes | yes | 9 | School, FeePayment | [schoolId, number] | Issued the moment a payment is verified. `number` comes from a per-school sequence inside that same transaction, so two clerks accepting at  |
| SchoolPaymentConfig | yes | yes | 11 | School | [schoolId, provider] | Per-school, per-provider gateway configuration. One row per provider a school has touched. `config` holds the provider's own declared fields |
| SchoolBankDetail | yes | yes | 14 | School |  | The bank account parents transfer into. Deliberately NOT secret — it is a deposit account, printed on the bill and shown in the portal. `isV |
| FeeAudit | yes | yes | 12 | School |  | Every financial mutation, hash-chained so tampering is detectable rather than merely discouraged. `prevHash` is the previous row's `hash` fo |
| FeeCounter | yes | yes | 4 | School |  | Per-school, per-series counter behind receipt and invoice numbers. Bumped by the `fee_next_number(school, series)` SQL function inside the c |
| FeeSettings | yes | yes | 9 | School |  | One row per school, created on first read with these defaults — the same shape `LibrarySettings` uses, and for the same reason: the school s |
| PressIssue | yes | yes | 15 | School, Student, ReportWindow | [schoolId, type, serial] | One row per issued document. `serial` comes from `press_next_number` (an atomic per-school upsert, same shape as `fee_next_number`) inside t |
| PressCounter | yes | yes | 4 | School |  | Per-school, per-series serial counter. Reached only through `press_next_number` — never read-then-write from application code (READ COMMITTE |
| ReportWindow | yes | yes | 13 | School, AcademicYear, ReportRemark, PressIssue | [schoolId, academicYearId, name] | A reporting period — "Term I", "Half-Yearly". The ONE configuration the report card needs: everything else (marks, attendance, grades) is co |
| ReportRemark | yes | yes | 12 | School, ReportWindow, Student | [windowId, studentId] | The class teacher's sentence on a child, per reporting window. Editable until the card is issued; the issued card carries its own copy in th |
| ResultNudge | yes | yes | 10 | School |  | The Result Room's nudge log: one row per reminder an admin sent a teacher about pending marks. Exists so the room can show "nudged yesterday |
| PrintOrder | yes | yes | 20 | School, PrintOrderEvent |  |  |
| PrintOrderEvent | yes | yes | 10 | School, PrintOrder |  |  |

## Enums

| Enum | Values |
| --- | --- |
| Tier | BASIC, STANDARD, PRO |
| SchoolStatus | SETUP, LIVE, SUSPENDED |
| DomainType | SUBDOMAIN, CUSTOM |
| DomainStatus | PENDING, LIVE, ERROR |
| EmailSenderMode | DEFAULT, CUSTOM |
| EmailSenderStatus | UNVERIFIED, VERIFIED, FAILING |
| UserRole | OWNER, SCHOOL_ADMIN, TEACHER, STUDENT, STAFF, ALUMNUS, LIBRARIAN |
| MediaKind | LOGO, FAVICON, HERO, GALLERY, STAFF, EVENT, PRINCIPAL, COURSE, HOF, ABOUT, AVATAR |
| SocialPlatform | FACEBOOK, INSTAGRAM, YOUTUBE, X, LINKEDIN |
| MenuKind | CLASS, PAGE, CUSTOM |
| EventAudienceKind | SCHOOL_ONLY, CITY, SELECTED, EVERYWHERE |
| EventScope | SCHOOL, NETWORK |
| EventStatus | DRAFT, PENDING, APPROVED, REJECTED |
| RegistrationStatus | HELD, CONFIRMED, WAITLISTED, DECLINED, CANCELLED |
| PaymentStatus | NOT_REQUIRED, PENDING, PAID, REFUNDED |
| EnquiryStatus | NEW, CONTACTED, VISITED, APPLIED, ENROLLED, CLOSED, LOST |
| AttendanceStatus | PRESENT, ABSENT, LATE |
| PeriodKind | CLASS, BREAK |
| StaffRole | OFFICE, SUPPORT, DRIVER, HELPER, SECURITY, LIBRARIAN, OTHER |
| LeaveType | SICK, CASUAL, EARNED, UNPAID, OTHER |
| LeaveStatus | PENDING, APPROVED, REJECTED, CANCELLED |
| PersonAttendanceStatus | PRESENT, ABSENT, LATE, ON_LEAVE |
| ClassNoteVisibility | ALL_TEACHERS, SUBJECT_TEACHERS |
| HallOfFameGroupKind | COURSE, GRADES, CUSTOM |
| LeadStatus | NEW, CONTACTED, QUALIFIED, DEMO, WON, LOST, CLOSED |
| LeadActivityKind | NOTE, CALL, WHATSAPP, EMAIL, MEETING, STAGE_CHANGE |
| BlogScope | PLATFORM, SCHOOL |
| BlogStatus | DRAFT, PUBLISHED |
| BlogGlobalStatus | NONE, PENDING, APPROVED, REJECTED |
| RegisterChangeStatus | PENDING, APPROVED, REJECTED |
| DiaryEntryKind | ITEM, REMARK |
| DiaryAudience | ALL, SELECTED |
| JobStatus | DRAFT, PENDING, APPROVED, REJECTED, CLOSED |
| EmploymentType | FULL_TIME, PART_TIME, CONTRACT, TEMPORARY |
| JobQuestionKind | CHOICE, YES_NO, NUMBER, TEXT |
| JobApplicationStatus | NEW, SHORTLISTED, INTERVIEWING, REJECTED, HIRED |
| LibraryFineReason | LATE, LOST |
| LibraryFineStatus | DUE, PAID, WAIVED |
| LibraryHallSource | SYNCED, RETAKEN |
| AlumniStatus | SCHOOL_ADDED, INVITED, PENDING, VERIFIED, DECLINED, HIDDEN |
| ClaimStatus | PENDING, VERIFIED, DECLINED |
| GiftScope | SCHOOL, GRADE, SECTION |
| GiftMode | FUND, SUPPLY |
| GiftStatus | PROPOSED, ACCEPTED, DECLINED, COUNTERED, CANCELLED, PICKUP_REQUESTED, PICKED_UP, RECEIVED, PURCHASED, DISTRIBUTED, REPORTED |
| GiftAttachmentKind | BILL, CONSIGNMENT, DISTRIBUTION |
| GiftDedication | NONE, IN_MEMORY_OF, IN_HONOUR_OF |
| GiftVisibility | PUBLIC, ALUMNI, ANONYMOUS |
| GuestSessionMode | IN_PERSON, ONLINE |
| GuestSessionStatus | REQUESTED, COUNTERED, SCHEDULED, DECLINED, CANCELLED, DELIVERED |
| AlumniTokenKind | CLAIM, SESSION |
| LinkRequestStatus | PENDING, SENT, DISMISSED |
| FeeFrequency | PER_TERM, ANNUAL, ONE_TIME |
| FeePaymentStatus | SUBMITTED, VERIFIED, REJECTED, REVERSED |
| FeePaymentMethod | UPI, NEFT_IMPS, CHEQUE, CASH, CARD, NETBANKING, OTHER |
| FeeLedgerKind | DEBIT, CREDIT |
| LateFeeMode | NONE, FLAT, PER_DAY |
