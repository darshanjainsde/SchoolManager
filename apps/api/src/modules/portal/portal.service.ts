import { Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma, withTenant, type AttendanceStatus, type TenantTx } from '@skoolos/db';
import type {
  Announcement,
  AttendanceDay,
  AttendanceSummary,
  Holiday,
  Profile,
  DiarySignResult,
  PublishedResult,
  StudentAssignment,
  StudentAssignmentList,
  StudentDiaryResult,
  TimetableSlot,
  UpcomingExam,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isP2002 } from '../../common/errors/prisma-errors';
import { TenantContextService } from '../tenancy';
import { RegistrationsService } from '../community';
import { TimetableService } from '../management';
import { HolidaysService } from '../management';
import { DiaryService } from '../management';
import { LIST_CEILING } from '../../common/lists/list-ceiling';

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * The deployment region is `bom1` (India) and school days are IST days, so
 * "this month" must mean the current *IST* month regardless of the server's
 * own OS timezone. `en-CA` renders as `YYYY-MM-DD`, which slices cleanly.
 */
const IST_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type {
  Announcement,
  AttendanceDay,
  AttendanceSummary,
  Profile,
  DiarySignResult,
  PublishedResult,
  StudentAssignment,
  StudentAssignmentList,
  StudentDiaryResult,
  UpcomingExam,
};

/** Shown when an Exam's Subject row cannot be read (deleted mid-term, etc.). */
const FALLBACK_SUBJECT_NAME = 'General';

/** `Date` (stored as `@db.Date`, i.e. UTC midnight) → `YYYY-MM-DD`. */
function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class PortalService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly timetableSvc: TimetableService,
    private readonly holidaysSvc: HolidaysService,
    private readonly diarySvc: DiaryService,
    private readonly registrations: RegistrationsService,
  ) {}

  /**
   * A signed-in family taking a place at an event.
   *
   * The public door (`POST /public/events/:id/register`) can only file a GUEST
   * row: a name, an email, and no link to anybody the school already knows.
   * When the family is signed in the school can have the real record — the
   * pupil, their class, their admission number — and can tell its own families
   * from walk-ins on the desk.
   *
   * Like every other route on this controller the pupil comes from the caller's
   * own JWT, never from the request, and no guest fields are forwarded: there
   * is nothing here a caller could say to be filed as somebody else.
   */
  async registerForEvent(userId: string, eventId: string, quantity = 1) {
    const { schoolId } = this.tenant.requireTenant();
    const student = await this.myStudent(schoolId, userId);
    // A TEACHER/STAFF login is signed in and has no Student row; it is not an
    // error worth a 500 — that person registers through the public door.
    if (!student) throw new NotFoundException('No student record for this login');

    // Clamped here as well as in the DTO: the validator is one door into this
    // method, not the only one.
    const seats = Math.max(1, Math.min(20, Math.trunc(quantity) || 1));

    const row = await this.registrations.register(eventId, {
      studentId: student.id,
      quantity: seats,
      fromSchoolId: schoolId,
      // The same rule the public door obeys: seats on another school's event
      // cannot be counted from here, so they cannot be sold from here either.
      requireHostedBy: schoolId,
    });
    return {
      id: row.id,
      status: row.status,
      waitlistPos: row.waitlistPos ?? null,
      quantity: row.quantity,
    };
  }

  /**
   * The child's own diary page(s) — see `DiaryService.studentDiary`, which
   * resolves the Student row from this JWT `sub` exactly like `myStudent`
   * does and never takes a student id from the caller.
   */
  async diary(userId: string, date?: string): Promise<StudentDiaryResult> {
    const { schoolId } = this.tenant.requireTenant();
    return this.diarySvc.studentDiary(schoolId, userId, date);
  }

  /** The parent's signature on a red-ink remark. */
  async signDiary(userId: string, id: string, signedName: string): Promise<DiarySignResult> {
    const { schoolId } = this.tenant.requireTenant();
    return this.diarySvc.sign(schoolId, userId, id, signedName);
  }

  /**
   * Upcoming school holidays for the CALLING user — any authenticated school
   * role, not just STUDENT. Deliberately does NOT go through `myStudent`
   * (same caution as `registerPushToken` above): a TEACHER/STAFF/
   * SCHOOL_ADMIN login has no `Student` row at all, and the holiday
   * calendar is school-wide, not per-student. `HolidaysService.list` is the
   * SAME query `/manage/holidays` (admin CRUD) reads with — one upcoming
   * list, two callers.
   */
  async holidays(): Promise<Holiday[]> {
    const { schoolId } = this.tenant.requireTenant();
    return this.holidaysSvc.list(schoolId);
  }

  /**
   * Registers (or refreshes) an Expo device token for the CALLING user —
   * any authenticated school role, not just STUDENT. Deliberately does NOT
   * go through `myStudent`: a TEACHER/STAFF/SCHOOL_ADMIN login has no
   * `Student` row at all, and this endpoint must work for every role the
   * mobile app supports.
   *
   * Upserts by `token` (its own unique key — Expo issues one per
   * app-install) inside this school's tenant scope, so a re-registering
   * device just refreshes its existing row's owner/timestamp rather than
   * accumulating duplicates. `PushChannel` later reads these rows by email
   * with the platform (cross-tenant) client — see push.channel.ts — but
   * writing them stays tenant-scoped like every other portal mutation.
   *
   * CROSS-TENANT REASSIGNMENT: `token` is globally unique, but the upsert
   * below runs RLS-bound to THIS school. If the same physical device
   * previously registered under a DIFFERENT school (a shared/demo device, or
   * someone who is staff at one school and a guardian at another), that row
   * is invisible to this transaction's tenant scope — yet Postgres's
   * (RLS-blind) unique index still reports a conflict that `ON CONFLICT DO
   * UPDATE` cannot resolve, so Prisma throws P2002. A device token is a
   * per-DEVICE identity, not a per-tenant one, so the correct response is to
   * REASSIGN the row to the new registrant (last-writer-wins) rather than
   * error — erroring would leave that device stuck receiving the OLD
   * tenant's push notifications on every retry. The reassignment itself uses
   * `getPlatformPrisma()` (BYPASSRLS, the same client `PushChannel` reads
   * with) since updating a row outside this transaction's tenant scope
   * requires bypassing RLS by design, not as a workaround.
   */
  async registerPushToken(userId: string, token: string, platform: string) {
    const { schoolId } = this.tenant.requireTenant();
    let email!: string;
    try {
      return await withTenant(schoolId, async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
        if (!user) throw new NotFoundException('No user record for this login');
        email = user.email;
        return tx.pushToken.upsert({
          where: { token },
          update: { schoolId, userId, email: user.email, lastSeenAt: new Date() },
          create: { schoolId, userId, email: user.email, token, platform },
        });
      });
    } catch (e) {
      if (!isP2002(e)) throw e;
      // Deliberately keyed on the token ALONE, and deliberately on the
      // platform (BYPASSRLS) client.
      //
      // A 4 Sept 2026 audit flagged this as the one privileged write keyed on
      // attacker input: someone holding another device's Expo token could
      // re-point that row into their own school. That is true, and it is
      // still the right behaviour. A push token is a per-DEVICE identity, not
      // a per-tenant one (see push.channel.ts). A phone handed from one child
      // to a sibling at another school must re-register, and last-writer-wins
      // is what stops the device continuing to receive the PREVIOUS school's
      // notifications — a worse leak, and a far likelier one, than the theft
      // the narrower predicate would prevent.
      //
      // Adding `userId` here was tried and reverted: it breaks that case
      // silently. The precondition for abuse is real but narrow — the token is
      // device-local and no API returns it.
      return getPlatformPrisma().pushToken.update({
        where: { token },
        data: { schoolId, userId, email, platform, lastSeenAt: new Date() },
      });
    }
  }

  private async myStudent(schoolId: string, userId: string) {
    return withTenant(schoolId, (tx) =>
      tx.student.findFirst({
        where: { schoolId, userId },
        include: { classSection: { select: { id: true, name: true } } },
      }),
    );
  }

  async profile(userId: string): Promise<Profile> {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    // Resolve photo URL if present (mirror how public-site resolves asset ids).
    let photoUrl: string | null = null;
    if (s.photoAssetId) {
      photoUrl = await withTenant(schoolId, async (tx) => {
        const a = await tx.mediaAsset.findFirst({ where: { id: s.photoAssetId! }, select: { url: true } });
        return a?.url ?? null;
      });
    }
    return {
      firstName: s.firstName,
      lastName: s.lastName,
      admissionNo: s.admissionNo,
      code: s.code ?? null,
      rollNo: s.rollNo,
      className: s.classSection?.name ?? null,
      photoUrl,
    };
  }

  async timetable(userId: string): Promise<TimetableSlot[]> {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    if (!s.classSectionId) return [];
    return this.timetableSvc.listForClass(schoolId, s.classSectionId);
  }

  async announcements(userId: string): Promise<Announcement[]> {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    const rows = await withTenant(schoolId, (tx) =>
      tx.announcement.findMany({
        where: {
          schoolId,
          OR: [{ classSectionId: null }, ...(s.classSectionId ? [{ classSectionId: s.classSectionId }] : [])],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
    // Prisma types `createdAt` as `Date`; the shared `Announcement` contract
    // types it as an ISO string — the shape every consumer (web, mobile)
    // actually receives once Nest's JSON serializer runs `Date.prototype.toJSON`.
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      classSectionId: r.classSectionId,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * This student's own attendance for one calendar month, plus the summary
   * counts the portal header renders.
   *
   * `month` is `YYYY-MM` and defaults to the current IST month. The range is
   * built as `[first of month, first of next month)` in UTC because
   * `Attendance.date` is a `@db.Date` column (stored at UTC midnight), so a
   * half-open range never double-counts or drops a boundary day.
   *
   * The `studentId` filter is the caller's OWN `Student.id`, resolved from
   * their JWT `sub` via `myStudent` — never a client-supplied id. `Attendance`
   * carries no RLS of its own, so both `schoolId` and `studentId` here are
   * load-bearing, not defensive.
   */
  async attendance(userId: string, month?: string): Promise<AttendanceSummary> {
    const { schoolId } = this.tenant.requireTenant();

    const trimmedMonth = month?.trim();
    const monthKey = trimmedMonth ? trimmedMonth : IST_DAY_FORMATTER.format(new Date()).slice(0, 7);
    if (!MONTH_RE.test(monthKey)) {
      throw new ApiError('VALIDATION', 'month must be formatted as YYYY-MM', 400, 'month');
    }
    const year = Number(monthKey.slice(0, 4));
    const monthIndex = Number(monthKey.slice(5, 7)) - 1;
    if (monthIndex < 0 || monthIndex > 11) {
      throw new ApiError('VALIDATION', 'month must be between 01 and 12', 400, 'month');
    }
    const start = new Date(Date.UTC(year, monthIndex, 1));
    const end = new Date(Date.UTC(year, monthIndex + 1, 1));

    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');

    const [rows, firstMark] = await withTenant(schoolId, (tx) =>
      Promise.all([
        tx.attendance.findMany({ take: LIST_CEILING.ACTIVITY,
          where: { schoolId, studentId: s.id, date: { gte: start, lt: end } },
          orderBy: { date: 'asc' },
          select: { date: true, status: true },
        }),
        tx.attendance.aggregate({
          where: { schoolId, studentId: s.id },
          _min: { date: true },
        }),
      ]),
    );

    // The month floor the client may walk back to: registration month, or the
    // first recorded mark if imported data predates the row's createdAt.
    const registeredMonth = IST_DAY_FORMATTER.format(s.createdAt).slice(0, 7);
    const firstMarkMonth = firstMark._min.date ? toDateKey(firstMark._min.date).slice(0, 7) : null;
    const earliestMonth =
      firstMarkMonth && firstMarkMonth < registeredMonth ? firstMarkMonth : registeredMonth;

    let present = 0;
    let absent = 0;
    let late = 0;
    for (const row of rows) {
      if (row.status === 'PRESENT') present += 1;
      else if (row.status === 'ABSENT') absent += 1;
      else if (row.status === 'LATE') late += 1;
    }

    const total = present + absent + late;
    // A brand-new school has no marks at all — report 0%, never NaN.
    const percent = total === 0 ? 0 : Math.round((present / total) * 100);

    return {
      month: monthKey,
      earliestMonth,
      percent,
      present,
      absent,
      late,
      days: rows.map((row) => ({ date: toDateKey(row.date), status: row.status })),
    };
  }

  /**
   * Tests still ahead of the student, for their OWN class section only.
   *
   * A student with no section has no exams to sit — `[]`, not an error.
   * `Exam` has no RLS, so the `schoolId` filter is load-bearing alongside the
   * `classSectionId` (itself read off the caller's own Student row, never
   * supplied by the client).
   */
  async exams(userId: string): Promise<UpcomingExam[]> {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    if (!s.classSectionId) return [];

    const classSectionId = s.classSectionId;
    const now = new Date();

    return withTenant(schoolId, async (tx) => {
      const exams = await tx.exam.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, classSectionId, scheduledAt: { gte: now } },
        orderBy: [{ scheduledAt: 'asc' }],
      });
      if (exams.length === 0) return [];

      const subjectNames = await this.subjectNames(
        tx,
        schoolId,
        exams.map((e) => e.subjectId),
      );

      return exams.map((e) => ({
        id: e.id,
        title: e.title,
        subjectName: subjectNames.get(e.subjectId) ?? FALLBACK_SUBJECT_NAME,
        // Prisma types `scheduledAt` as `Date`; the shared `UpcomingExam`
        // contract types it as an ISO string, matching the wire.
        scheduledAt: e.scheduledAt.toISOString(),
        maxMarks: e.maxMarks,
        syllabus: e.syllabus,
      }));
    });
  }

  /**
   * The student's OWN published results, each with the class average for that
   * exam so they can see where they landed.
   *
   * Two privacy rules are enforced here:
   *  1. Only rows keyed on the caller's own `Student.id` are ever read as
   *     individual marks — `studentId` comes from `myStudent`, never the
   *     client.
   *  2. The class average is computed with `groupBy` + `_avg` in the database,
   *     so no other student's individual mark is ever loaded into this
   *     process, let alone serialised into the response.
   *
   * Unpublished results (`publishedAt = null`) are excluded from BOTH the
   * student's own rows and the average — an in-progress marking run must not
   * leak through the average either.
   */
  async results(userId: string): Promise<PublishedResult[]> {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');

    return withTenant(schoolId, async (tx) => {
      const mine = await tx.result.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, studentId: s.id, publishedAt: { not: null } },
        select: { examId: true, marks: true },
      });
      if (mine.length === 0) return [];

      const examIds = mine.map((r) => r.examId);

      // `Exam` has no RLS — the schoolId filter is what keeps a foreign
      // school's exam out even if a Result row somehow pointed at one.
      const exams = await tx.exam.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, id: { in: examIds } },
      });
      const examById = new Map(exams.map((e) => [e.id, e]));

      const averages = await tx.result.groupBy({
        by: ['examId'],
        where: { schoolId, examId: { in: examIds }, publishedAt: { not: null } },
        _avg: { marks: true },
      });
      const averageByExam = new Map(
        averages.map((a) => [a.examId, a._avg.marks ?? 0]),
      );

      const subjectNames = await this.subjectNames(
        tx,
        schoolId,
        exams.map((e) => e.subjectId),
      );

      // Built with `scheduledAt` still a `Date` so the sort below can compare
      // by time; converted to the wire's ISO-string shape only afterwards.
      const rows: { row: PublishedResult; scheduledAt: Date }[] = [];
      for (const r of mine) {
        const exam = examById.get(r.examId);
        if (!exam) continue; // foreign / deleted exam — drop rather than leak
        rows.push({
          scheduledAt: exam.scheduledAt,
          row: {
            examId: exam.id,
            title: exam.title,
            subjectName: subjectNames.get(exam.subjectId) ?? FALLBACK_SUBJECT_NAME,
            scheduledAt: exam.scheduledAt.toISOString(),
            marks: r.marks,
            maxMarks: exam.maxMarks,
            classAverage: Math.round((averageByExam.get(r.examId) ?? 0) * 10) / 10,
          },
        });
      }

      // Most recent test first.
      rows.sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
      return rows.map((r) => r.row);
    });
  }

  /**
   * The student's own class section's Assignments, split into `upcoming`
   * (due today or later) and `past`, each ordered by dueDate ascending —
   * same split rule `AssignmentsService.list` uses on the teacher side
   * (today counts as upcoming; a same-day due date has not passed yet).
   *
   * A student with no section has no assignments to see — `[]`/`[]`, not an
   * error. `subjectName` is resolved here (a student has no
   * `/manage/subjects` access, unlike the teacher-facing `Assignment`
   * contract which leaves that to the caller).
   */
  async assignments(userId: string): Promise<StudentAssignmentList> {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    if (!s.classSectionId) return { upcoming: [], past: [] };

    const classSectionId = s.classSectionId;
    const today = IST_DAY_FORMATTER.format(new Date());

    return withTenant(schoolId, async (tx) => {
      const rows = await tx.assignment.findMany({
        take: LIST_CEILING.ACTIVITY,
        where: { schoolId, classSectionId },
        orderBy: [{ dueDate: 'asc' }],
      });
      if (rows.length === 0) return { upcoming: [], past: [] };

      const subjectNames = await this.subjectNames(
        tx,
        schoolId,
        rows.map((r) => r.subjectId),
      );

      const upcoming: StudentAssignment[] = [];
      const past: StudentAssignment[] = [];
      for (const r of rows) {
        const item: StudentAssignment = {
          id: r.id,
          subjectId: r.subjectId,
          subjectName: subjectNames.get(r.subjectId) ?? FALLBACK_SUBJECT_NAME,
          title: r.title,
          instructions: r.instructions,
          dueDate: toDateKey(r.dueDate),
          attachments: (r.attachments ?? []) as unknown as StudentAssignment['attachments'],
          createdAt: r.createdAt.toISOString(),
        };
        if (toDateKey(r.dueDate) >= today) {
          upcoming.push(item);
        } else {
          past.push(item);
        }
      }
      return { upcoming, past };
    });
  }

  /**
   * Marks one Assignment as "seen" by the calling student — idempotent by
   * construction (upserts on `AssignmentSeen`'s unique `(assignmentId,
   * studentId)` pair, so re-opening the same assignment twice never creates
   * a second row or errors).
   *
   * The assignment must belong to the CALLER'S OWN class section — resolved
   * from the student's stored `classSectionId`, never trusted from the
   * client beyond the id itself. Without this check a student could mark an
   * assignment from a class they don't belong to as "seen", corrupting that
   * other class's teacher-facing seen-count.
   */
  async markAssignmentSeen(userId: string, assignmentId: string): Promise<{ ok: true }> {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    if (!s.classSectionId) throw new NotFoundException('Assignment not found');

    const classSectionId = s.classSectionId;
    const studentId = s.id;

    return withTenant(schoolId, async (tx) => {
      const assignment = await tx.assignment.findFirst({
        where: { id: assignmentId, schoolId, classSectionId },
        select: { id: true },
      });
      if (!assignment) throw new NotFoundException('Assignment not found');

      await tx.assignmentSeen.upsert({
        where: { one_seen_per_assignment_student: { assignmentId, studentId } },
        // `schoolId` comes from the resolved tenant, not from caller input —
        // `AssignmentSeen` carries it directly since
        // 20260825090000_result_tenancy_and_fk_indexes.
        create: { schoolId, assignmentId, studentId },
        update: {},
      });
      return { ok: true };
    });
  }

  /**
   * `subjectId -> Subject.name` for the ids given, in one query, scoped to
   * this school. `Exam` has no `subject` relation in the schema, so the name
   * has to be resolved separately rather than `include`d.
   */
  private async subjectNames(
    tx: TenantTx,
    schoolId: string,
    subjectIds: string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(subjectIds)];
    if (ids.length === 0) return new Map();
    const subjects = await tx.subject.findMany({ take: LIST_CEILING.STRUCTURE,
      where: { schoolId, id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(subjects.map((s) => [s.id, s.name]));
  }
}
