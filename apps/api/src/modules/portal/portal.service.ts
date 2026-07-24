import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type AttendanceStatus, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { TenantContextService } from '../tenancy';
import { TimetableService } from '../management/timetable.service';

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

export interface AttendanceDay {
  /** `YYYY-MM-DD` */
  date: string;
  status: AttendanceStatus;
}

export interface AttendanceSummary {
  /** `YYYY-MM` — echoes back the month actually queried. */
  month: string;
  /** present / (present + absent + late) * 100, rounded. 0 with no records. */
  percent: number;
  present: number;
  absent: number;
  late: number;
  days: AttendanceDay[];
}

export interface UpcomingExam {
  id: string;
  title: string;
  subjectName: string;
  scheduledAt: Date;
  maxMarks: number;
  syllabus: string | null;
}

export interface PublishedResult {
  examId: string;
  title: string;
  subjectName: string;
  scheduledAt: Date;
  marks: number;
  maxMarks: number;
  /** Mean of every published Result for this exam, to 1 decimal place. */
  classAverage: number;
}

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
  ) {}

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
   */
  async registerPushToken(userId: string, token: string, platform: string) {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (!user) throw new NotFoundException('No user record for this login');
      return tx.pushToken.upsert({
        where: { token },
        update: { schoolId, userId, email: user.email, lastSeenAt: new Date() },
        create: { schoolId, userId, email: user.email, token, platform },
      });
    });
  }

  private async myStudent(schoolId: string, userId: string) {
    return withTenant(schoolId, (tx) =>
      tx.student.findFirst({
        where: { userId },
        include: { classSection: { select: { id: true, name: true } } },
      }),
    );
  }

  async profile(userId: string) {
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
      rollNo: s.rollNo,
      className: s.classSection?.name ?? null,
      photoUrl,
    };
  }

  async timetable(userId: string) {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    if (!s.classSectionId) return [];
    return this.timetableSvc.listForClass(schoolId, s.classSectionId);
  }

  async announcements(userId: string) {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    return withTenant(schoolId, (tx) =>
      tx.announcement.findMany({
        where: {
          schoolId,
          OR: [{ classSectionId: null }, ...(s.classSectionId ? [{ classSectionId: s.classSectionId }] : [])],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
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

    const rows = await withTenant(schoolId, (tx) =>
      tx.attendance.findMany({
        where: { schoolId, studentId: s.id, date: { gte: start, lt: end } },
        orderBy: { date: 'asc' },
        select: { date: true, status: true },
      }),
    );

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
      const exams = await tx.exam.findMany({
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
        scheduledAt: e.scheduledAt,
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
      const mine = await tx.result.findMany({
        where: { studentId: s.id, publishedAt: { not: null } },
        select: { examId: true, marks: true },
      });
      if (mine.length === 0) return [];

      const examIds = mine.map((r) => r.examId);

      // `Exam` has no RLS — the schoolId filter is what keeps a foreign
      // school's exam out even if a Result row somehow pointed at one.
      const exams = await tx.exam.findMany({
        where: { schoolId, id: { in: examIds } },
      });
      const examById = new Map(exams.map((e) => [e.id, e]));

      const averages = await tx.result.groupBy({
        by: ['examId'],
        where: { examId: { in: examIds }, publishedAt: { not: null } },
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

      const rows: PublishedResult[] = [];
      for (const r of mine) {
        const exam = examById.get(r.examId);
        if (!exam) continue; // foreign / deleted exam — drop rather than leak
        rows.push({
          examId: exam.id,
          title: exam.title,
          subjectName: subjectNames.get(exam.subjectId) ?? FALLBACK_SUBJECT_NAME,
          scheduledAt: exam.scheduledAt,
          marks: r.marks,
          maxMarks: exam.maxMarks,
          classAverage: Math.round((averageByExam.get(r.examId) ?? 0) * 10) / 10,
        });
      }

      // Most recent test first.
      rows.sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
      return rows;
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
    const subjects = await tx.subject.findMany({
      where: { schoolId, id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(subjects.map((s) => [s.id, s.name]));
  }
}
