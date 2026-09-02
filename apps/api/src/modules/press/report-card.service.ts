import { Injectable, Logger } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import type {
  IssueReportCardsResponse,
  PressSchoolHeader,
  ReportCardBatch,
  ReportCardSnapshot,
  ReportCardStudent,
  ReportSubjectLine,
  ReportWindowRow,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { isP2002, p2002Target } from '../../common/errors/prisma-errors';
import { gradeForPct, pctOf } from './grade-scale';
import type { IssueReportCardsDto, SaveRemarkDto, SaveWindowDto } from './press.dto';

/**
 * Compiles report cards from what teachers already entered — and nothing else.
 *
 * There is deliberately NO stored mark, grade or percentage anywhere in this
 * module. A card is a computation over `Exam`/`Result`/`Attendance` inside a
 * `ReportWindow`'s date range, done identically for the office preview, the
 * printed batch and the parent's copy (the `late-fee.ts` rule, applied to
 * marks). The only stored artefacts are the window itself, the class
 * teacher's remark, and — once the office issues — the immutable snapshot in
 * the `PressIssue` register.
 */

/** IST year for serial series — a card issued at 11:30pm UTC on 31 Dec is next year's here. */
export function seriesYear(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(now));
}

/** "Roll 8" must sort before "roll 10", and lettered rolls must not crash the sort. */
export function rollOrder(a: { rollNo: string | null; name: string }, b: { rollNo: string | null; name: string }): number {
  // '' would coerce to 0 and jump the queue; a blank roll is no roll.
  const na = a.rollNo === null || a.rollNo.trim() === '' ? NaN : Number(a.rollNo);
  const nb = b.rollNo === null || b.rollNo.trim() === '' ? NaN : Number(b.rollNo);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  if (!Number.isNaN(na) && Number.isNaN(nb)) return -1;
  if (Number.isNaN(na) && !Number.isNaN(nb)) return 1;
  return a.name.localeCompare(b.name);
}

/**
 * Window boundaries in the school's clock, not the server's. A DATE column
 * comes back as UTC midnight; the IST day it names starts 5h30 EARLIER as a
 * UTC instant. Without this shift an exam at 2:00 AM IST on 1 Oct (stored
 * 20:30 UTC 30 Sep) prints under the term that ended 30 Sep. Same reasoning
 * as `seriesYear` below — the product's clock is Asia/Kolkata.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** UTC instant at which the IST calendar day of `d` (a DATE column) begins. */
function istDayStartUtc(d: Date): Date {
  return new Date(d.getTime() - IST_OFFSET_MS);
}

/** UTC instant at which the IST day AFTER `d` begins — the exclusive bound. */
function istDayAfterUtc(d: Date): Date {
  return new Date(d.getTime() + 24 * 60 * 60 * 1000 - IST_OFFSET_MS);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class ReportCardService {
  private readonly logger = new Logger(ReportCardService.name);

  // ── Reference reads ────────────────────────────────────────────────────────
  // The Press carries its own class/year lists rather than borrowing
  // `/manage/classes` (MANAGEMENT + ADMIN/TEACHER): the front-office STAFF who
  // run this screen cannot call that route, and a PRESS-only school may not
  // even have the feature it is gated on.

  async listYears(schoolId: string): Promise<{ id: string; name: string; isCurrent: boolean; startDate: string }[]> {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.academicYear.findMany({
        select: { id: true, name: true, isCurrent: true, startDate: true },
        orderBy: { startDate: 'desc' },
      });
      // startDate feeds the first window's prefill — a new school should meet
      // a form that is already right, not four empty boxes.
      return rows.map((r) => ({ ...r, startDate: r.startDate.toISOString().slice(0, 10) }));
    });
  }

  async listClasses(schoolId: string): Promise<{ id: string; label: string; studentCount: number }[]> {
    return withTenant(schoolId, async (tx) => {
      const [sections, counts] = await Promise.all([
        tx.classSection.findMany({
          include: { grade: { select: { name: true, order: true } } },
        }),
        tx.student.groupBy({
          by: ['classSectionId'],
          where: { isActive: true, classSectionId: { not: null } },
          _count: { _all: true },
        }),
      ]);
      const countBySection = new Map(counts.map((c) => [c.classSectionId, c._count._all]));
      return sections
        .sort((a, b) => a.grade.order - b.grade.order || a.grade.name.localeCompare(b.grade.name) || a.name.localeCompare(b.name))
        .map((s) => ({
          id: s.id,
          label: `${s.grade.name}-${s.name}`,
          studentCount: countBySection.get(s.id) ?? 0,
        }));
    });
  }

  /** Name / admission-no search for the certificate desk. Same reasoning as
   *  `listClasses`: `/manage/students` is ADMIN/TEACHER, the Press desk is not. */
  async searchStudents(
    schoolId: string,
    q: string,
  ): Promise<{ id: string; name: string; admissionNo: string; classLabel: string | null; isActive: boolean }[]> {
    const query = q.trim();
    if (query.length < 2) return [];
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.student.findMany({
        where: {
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { admissionNo: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: { classSection: { include: { grade: { select: { name: true } } } } },
        orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
        take: 20,
      });
      // Left students stay findable — a TC is BY DEFINITION for somebody
      // leaving; hiding inactive rows would hide the certificate's audience.
      return rows.map((s) => ({
        id: s.id,
        name: `${s.firstName} ${s.lastName}`.trim(),
        admissionNo: s.admissionNo,
        classLabel: s.classSection ? `${s.classSection.grade.name}-${s.classSection.name}` : null,
        isActive: s.isActive,
      }));
    });
  }

  // ── Windows ────────────────────────────────────────────────────────────────

  async listWindows(schoolId: string): Promise<ReportWindowRow[]> {
    return withTenant(schoolId, async (tx) => {
      const rows = await tx.reportWindow.findMany({
        include: { academicYear: { select: { name: true } } },
        orderBy: [{ startDate: 'desc' }],
      });
      // Counted with an explicit windowId filter, not a relation `_count` —
      // the tenant-aggregates guard forbids the relation form outright.
      const counts = rows.length
        ? await tx.pressIssue.groupBy({
            by: ['windowId'],
            where: { windowId: { in: rows.map((w) => w.id) } },
            _count: { _all: true },
          })
        : [];
      const countByWindow = new Map(counts.map((c) => [c.windowId, c._count._all]));
      return rows.map((w) => ({
        id: w.id,
        academicYearId: w.academicYearId,
        academicYearName: w.academicYear.name,
        name: w.name,
        startDate: isoDay(w.startDate),
        endDate: isoDay(w.endDate),
        issuedCount: countByWindow.get(w.id) ?? 0,
      }));
    });
  }

  async saveWindow(schoolId: string, dto: SaveWindowDto): Promise<ReportWindowRow> {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end < start) {
      throw new ApiError('VALIDATION', 'The window must end after it starts.', 400, 'endDate');
    }
    return withTenant(schoolId, async (tx) => {
      // The year must be THIS school's — an FK alone would accept another
      // tenant's id, because referential integrity bypasses RLS.
      const year = await tx.academicYear.findFirst({
        where: { id: dto.academicYearId },
        select: { id: true, name: true },
      });
      if (!year) throw new ApiError('NOT_FOUND', 'That academic year was not found.', 404);

      const data = { name: dto.name.trim(), startDate: start, endDate: end };
      try {
        let row;
        if (dto.id) {
          // Prove the window is this tenant's FIRST: an update on somebody
          // else's id would throw P2025 under RLS and surface as a 500 —
          // every sibling path answers 404, so this one must too.
          const existing = await tx.reportWindow.findFirst({ where: { id: dto.id }, select: { id: true } });
          if (!existing) throw new ApiError('NOT_FOUND', 'That report window was not found.', 404);
          row = await tx.reportWindow.update({
            where: { id: dto.id },
            data: { ...data, academicYearId: dto.academicYearId },
          });
        } else {
          row = await tx.reportWindow.create({
            data: { ...data, schoolId, academicYearId: dto.academicYearId },
          });
        }
        const issuedCount = await tx.pressIssue.count({ where: { windowId: row.id } });
        return {
          id: row.id,
          academicYearId: row.academicYearId,
          academicYearName: year.name,
          name: row.name,
          startDate: isoDay(row.startDate),
          endDate: isoDay(row.endDate),
          issuedCount,
        };
      } catch (e) {
        if (isP2002(e)) {
          throw new ApiError('WINDOW_EXISTS', `A window named "${dto.name.trim()}" already exists for that year.`, 409, 'name');
        }
        throw e;
      }
    });
  }

  // ── Remarks ────────────────────────────────────────────────────────────────

  async saveRemark(schoolId: string, dto: SaveRemarkDto, authorId: string): Promise<{ saved: true }> {
    await withTenant(schoolId, async (tx) => {
      // Both ids are client-supplied foreign keys: prove each belongs to this
      // tenant before writing (the FK constraint would not).
      const [window, student] = await Promise.all([
        tx.reportWindow.findFirst({ where: { id: dto.windowId }, select: { id: true } }),
        tx.student.findFirst({ where: { id: dto.studentId }, select: { id: true } }),
      ]);
      if (!window) throw new ApiError('NOT_FOUND', 'That report window was not found.', 404);
      if (!student) throw new ApiError('NOT_FOUND', 'That student was not found.', 404);

      const text = dto.text.trim();
      if (text === '') {
        // Clearing a remark is deleting it, not storing an empty sentence.
        await tx.reportRemark.deleteMany({ where: { windowId: dto.windowId, studentId: dto.studentId } });
        return;
      }
      await tx.reportRemark.upsert({
        where: { windowId_studentId: { windowId: dto.windowId, studentId: dto.studentId } },
        create: { schoolId, windowId: dto.windowId, studentId: dto.studentId, text, authorId },
        update: { text, authorId },
      });
    });
    return { saved: true };
  }

  // ── Compile ────────────────────────────────────────────────────────────────

  async compileBatch(schoolId: string, windowId: string, classSectionId: string): Promise<ReportCardBatch> {
    return withTenant(schoolId, async (tx) => {
      const [window, section] = await Promise.all([
        tx.reportWindow.findFirst({
          where: { id: windowId },
          include: { academicYear: { select: { name: true } } },
        }),
        tx.classSection.findFirst({
          where: { id: classSectionId },
          include: {
            grade: { select: { name: true } },
            classTeacher: { select: { firstName: true, lastName: true } },
          },
        }),
      ]);
      if (!window) throw new ApiError('NOT_FOUND', 'That report window was not found.', 404);
      if (!section) throw new ApiError('NOT_FOUND', 'That class was not found.', 404);

      const windowIssuedCount = await tx.pressIssue.count({ where: { windowId } });

      const students = await tx.student.findMany({
        where: { classSectionId, isActive: true },
        select: {
          id: true, firstName: true, lastName: true, rollNo: true,
          admissionNo: true, dob: true, guardianName: true,
        },
      });

      const compiled = await this.compileStudents(tx, {
        schoolId, windowId, classSectionId,
        startDate: window.startDate, endDate: window.endDate,
        students,
      });

      return {
        window: {
          id: window.id,
          academicYearId: window.academicYearId,
          academicYearName: window.academicYear.name,
          name: window.name,
          startDate: isoDay(window.startDate),
          endDate: isoDay(window.endDate),
          issuedCount: windowIssuedCount,
        },
        classSection: {
          id: section.id,
          label: `${section.grade.name}-${section.name}`,
          classTeacherName: section.classTeacher
            ? `${section.classTeacher.firstName} ${section.classTeacher.lastName}`.trim()
            : null,
        },
        school: await this.schoolHeader(tx, schoolId),
        subjects: compiled.subjects,
        students: compiled.students,
        unpublishedCount: compiled.unpublishedCount,
      };
    });
  }

  /**
   * The aggregation core, shared by compile (preview) and issue (snapshot) so
   * the two can never drift: per subject, sum a student's marks over the
   * exams they have result rows for. A missing row is "no data" — shown as
   * "—", never counted as a zero, because an absence and a failed paper are
   * different facts and only one of them is in the database.
   */
  private async compileStudents(
    tx: TenantTx,
    input: {
      schoolId: string;
      windowId: string;
      classSectionId: string;
      startDate: Date;
      endDate: Date;
      students: {
        id: string; firstName: string; lastName: string; rollNo: string | null;
        admissionNo: string; dob: Date | null; guardianName: string | null;
      }[];
    },
  ): Promise<{ subjects: { subjectId: string; subjectName: string }[]; students: ReportCardStudent[]; unpublishedCount: number }> {
    const { windowId, classSectionId, startDate, endDate, students } = input;
    const studentIds = students.map((s) => s.id);

    const exams = await tx.exam.findMany({
      where: {
        classSectionId,
        scheduledAt: { gte: istDayStartUtc(startDate), lt: istDayAfterUtc(endDate) },
      },
      select: { id: true, subjectId: true, maxMarks: true },
    });
    const examIds = exams.map((e) => e.id);

    // Surfaced on the batch screen: dashes caused by UNPUBLISHED marks look
    // identical to dashes caused by absence, and the office deserves to know
    // which it is before printing.
    const unpublishedCount = examIds.length
      ? await tx.result.count({
          where: { examId: { in: examIds }, studentId: { in: studentIds }, publishedAt: null },
        })
      : 0;

    const [results, subjectRows, attendanceRows, remarkRows, issuedRows] = await Promise.all([
      examIds.length
        ? tx.result.findMany({
            // PUBLISHED only — the same invariant the portal enforces
            // (portal.service filters publishedAt everywhere). A report card
            // GOES to the family; draft marks a teacher has not published
            // must not be frozen into a snapshot the portal then serves.
            where: { examId: { in: examIds }, studentId: { in: studentIds }, publishedAt: { not: null } },
            select: { examId: true, studentId: true, marks: true },
          })
        : Promise.resolve([]),
      exams.length
        ? tx.subject.findMany({
            where: { id: { in: [...new Set(exams.map((e) => e.subjectId))] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      studentIds.length
        ? tx.attendance.groupBy({
            by: ['studentId', 'status'],
            where: {
              classSectionId,
              studentId: { in: studentIds },
              // Attendance.date is itself a DATE — no clock to shift.
              date: { gte: startDate, lte: endDate },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      studentIds.length
        ? tx.reportRemark.findMany({
            where: { windowId, studentId: { in: studentIds } },
            select: { studentId: true, text: true },
          })
        : Promise.resolve([]),
      studentIds.length
        ? tx.pressIssue.findMany({
            // A voided card frees the slot — the batch treats that child as
            // not yet issued, matching the partial unique in the migration.
            where: { type: 'REPORT_CARD', windowId, studentId: { in: studentIds }, voidedAt: null },
            select: { studentId: true, serial: true, issuedAt: true },
          })
        : Promise.resolve([]),
    ]);

    // Column order: alphabetical, stable across preview and print.
    const subjects = subjectRows
      .map((s) => ({ subjectId: s.id, subjectName: s.name }))
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    const examsBySubject = new Map<string, { id: string; maxMarks: number }[]>();
    for (const e of exams) {
      const list = examsBySubject.get(e.subjectId) ?? [];
      list.push({ id: e.id, maxMarks: e.maxMarks });
      examsBySubject.set(e.subjectId, list);
    }
    const resultByExamStudent = new Map<string, number>();
    for (const r of results) resultByExamStudent.set(`${r.examId}:${r.studentId}`, r.marks);

    const attendanceByStudent = new Map<string, { present: number; total: number }>();
    for (const row of attendanceRows) {
      const agg = attendanceByStudent.get(row.studentId) ?? { present: 0, total: 0 };
      const n = row._count._all;
      agg.total += n;
      // LATE is "came, late" — a present child, not an absent one.
      if (row.status === 'PRESENT' || row.status === 'LATE') agg.present += n;
      attendanceByStudent.set(row.studentId, agg);
    }

    const remarkByStudent = new Map(remarkRows.map((r) => [r.studentId, r.text]));
    const issuedByStudent = new Map(
      issuedRows.map((r) => [r.studentId, { serial: r.serial, issuedAt: r.issuedAt.toISOString() }]),
    );

    const compiled = students
      .map((s) => {
        const lines: ReportSubjectLine[] = subjects.map(({ subjectId, subjectName }) => {
          const subjectExams = examsBySubject.get(subjectId) ?? [];
          let attempted = 0;
          let marks = 0;
          let attemptedMax = 0;
          let totalMax = 0;
          for (const e of subjectExams) {
            totalMax += e.maxMarks;
            const m = resultByExamStudent.get(`${e.id}:${s.id}`);
            if (m !== undefined) {
              attempted += 1;
              marks += m;
              attemptedMax += e.maxMarks;
            }
          }
          const hasMarks = attempted > 0;
          const pct = hasMarks ? pctOf(marks, attemptedMax) : null;
          return {
            subjectId,
            subjectName,
            examCount: subjectExams.length,
            // Float sums drift (36.7+42.1 = 78.80000000000001); one decimal
            // place at COMPILE time so no surface can print the artifact.
            marks: hasMarks ? Math.round(marks * 10) / 10 : null,
            maxMarks: hasMarks ? attemptedMax : totalMax,
            pct,
            grade: gradeForPct(pct),
          };
        });

        const marked = lines.filter((l) => l.marks !== null);
        const overallMarks = Math.round(marked.reduce((a, l) => a + (l.marks ?? 0), 0) * 10) / 10;
        const overallMax = marked.reduce((a, l) => a + l.maxMarks, 0);
        const overallPct = marked.length ? pctOf(overallMarks, overallMax) : null;

        const att = attendanceByStudent.get(s.id) ?? { present: 0, total: 0 };

        return {
          studentId: s.id,
          studentName: `${s.firstName} ${s.lastName}`.trim(),
          rollNo: s.rollNo,
          admissionNo: s.admissionNo,
          subjects: lines,
          overall: { marks: overallMarks, maxMarks: overallMax, pct: overallPct, grade: gradeForPct(overallPct) },
          attendance: {
            present: att.present,
            total: att.total,
            pct: att.total > 0 ? Math.round((att.present / att.total) * 100) : null,
          },
          remark: remarkByStudent.get(s.id) ?? null,
          issued: issuedByStudent.get(s.id) ?? null,
        };
      })
      .sort((a, b) => rollOrder({ rollNo: a.rollNo, name: a.studentName }, { rollNo: b.rollNo, name: b.studentName }));

    return { subjects, students: compiled, unpublishedCount };
  }

  /**
   * One child's compile for the LATEST report window — the Student 360's
   * academics panel. Same `compileStudents` core as the batch and the issued
   * snapshot, so the profile, the batch screen and the printed card can never
   * disagree. Null when the school has no window yet or the child no class.
   */
  async compileForStudent(schoolId: string, studentId: string): Promise<{
    windowName: string;
    academicYearName: string;
    subjects: import('@skoolos/types').ReportSubjectLine[];
    overall: ReportCardStudent['overall'];
    remark: string | null;
  } | null> {
    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { id: studentId },
        select: {
          id: true, firstName: true, lastName: true, rollNo: true,
          admissionNo: true, dob: true, guardianName: true, classSectionId: true,
        },
      });
      if (!student || !student.classSectionId) return null;
      const window = await tx.reportWindow.findFirst({
        orderBy: { startDate: 'desc' },
        include: { academicYear: { select: { name: true } } },
      });
      if (!window) return null;

      const compiled = await this.compileStudents(tx, {
        schoolId,
        windowId: window.id,
        classSectionId: student.classSectionId,
        startDate: window.startDate,
        endDate: window.endDate,
        students: [student],
      });
      const row = compiled.students[0];
      if (!row) return null;
      return {
        windowName: window.name,
        academicYearName: window.academicYear.name,
        subjects: row.subjects,
        overall: row.overall,
        remark: row.remark,
      };
    });
  }

  // ── Issue ──────────────────────────────────────────────────────────────────

  /**
   * Issuing = one serial + one snapshot row per student, each in its OWN short
   * transaction. A class of forty in a single transaction is exactly the shape
   * Supabase's 5-second interactive-transaction cap kills (it killed the fees
   * demo seed twice); forty small ones also mean a failure at student #23
   * leaves 22 real register rows and a response that says precisely who is
   * left. Retrying is safe: the (window, student) unique makes a second issue
   * a skip, never a second serial.
   */
  async issueBatch(schoolId: string, dto: IssueReportCardsDto, issuedById: string): Promise<IssueReportCardsResponse> {
    const batch = await this.compileBatch(schoolId, dto.windowId, dto.classSectionId);

    // De-duplicated: a repeated id must not read as "somebody not in class".
    const requested = dto.studentIds?.length ? [...new Set(dto.studentIds)] : null;
    const wanted = requested
      ? batch.students.filter((s) => requested.includes(s.studentId))
      : batch.students;
    if (requested && wanted.length !== requested.length) {
      // An id that is not in this class/window compile is either another
      // class's child or another school's — same answer either way.
      throw new ApiError('NOT_FOUND', 'One of those students is not in this class.', 404);
    }

    // dob/guardian are not in the batch rows; fetch once for the snapshots.
    const extras = await withTenant(schoolId, (tx) =>
      tx.student.findMany({
        where: { id: { in: wanted.map((s) => s.studentId) } },
        select: { id: true, dob: true, guardianName: true },
      }),
    );
    const extraById = new Map(extras.map((e) => [e.id, e]));

    const series = `RC/${seriesYear(new Date())}`;
    const issued: IssueReportCardsResponse['issued'] = [];
    const skipped: IssueReportCardsResponse['skipped'] = [];

    for (const s of wanted) {
      if (s.issued) {
        skipped.push({ studentId: s.studentId, reason: `Already issued (${s.issued.serial}).` });
        continue;
      }
      const extra = extraById.get(s.studentId);
      const snapshot: ReportCardSnapshot = {
        kind: 'REPORT_CARD',
        school: batch.school,
        windowName: batch.window.name,
        academicYearName: batch.window.academicYearName,
        classLabel: batch.classSection.label,
        classTeacherName: batch.classSection.classTeacherName,
        student: {
          name: s.studentName,
          rollNo: s.rollNo,
          admissionNo: s.admissionNo,
          dob: extra?.dob ? isoDay(extra.dob) : null,
          guardianName: extra?.guardianName ?? null,
        },
        subjects: s.subjects,
        overall: s.overall,
        attendance: s.attendance,
        remark: s.remark,
      };

      try {
        const serial = await withTenant(schoolId, async (tx) => {
          const [{ press_next_number: seq }] = await tx.$queryRaw<{ press_next_number: number }[]>`
            SELECT press_next_number(${schoolId}::uuid, ${series}::text)`;
          const full = `${series}/${String(seq).padStart(4, '0')}`;
          await tx.pressIssue.create({
            data: {
              schoolId,
              type: 'REPORT_CARD',
              serial: full,
              studentId: s.studentId,
              windowId: dto.windowId,
              payload: snapshot as object,
              issuedById,
            },
          });
          return full;
        });
        issued.push({ studentId: s.studentId, serial });
      } catch (e) {
        if (isP2002(e)) {
          // TWO uniques can throw here and they mean opposite things. The
          // window unique = a concurrent clerk got there first, the card
          // exists, skipping is the wanted outcome. The SERIAL unique = a
          // hand-reset counter collided and NO card exists — saying
          // "already issued" would be a false success.
          if (p2002Target(e).includes('serial')) {
            skipped.push({
              studentId: s.studentId,
              reason: 'Serial clash — the counter looks reset. No card was made; try again.',
            });
            this.logger.error({ schoolId, studentId: s.studentId }, 'press serial collision');
            continue;
          }
          skipped.push({ studentId: s.studentId, reason: 'Already issued by someone else just now.' });
          continue;
        }
        this.logger.error({ schoolId, studentId: s.studentId, err: e }, 'report card issue failed');
        throw e;
      }
    }

    return { issued, skipped };
  }

  // ── Shared ─────────────────────────────────────────────────────────────────

  /** The masthead every sheet prints, resolved once per compile/issue. */
  async schoolHeader(tx: TenantTx, schoolId: string): Promise<PressSchoolHeader> {
    const [school, profile] = await Promise.all([
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      tx.schoolProfile.findFirst({
        where: { schoolId },
        select: { logoAssetId: true, addressLine1: true, city: true, region: true, phone: true, email: true },
      }),
    ]);
    let logoUrl: string | null = null;
    if (profile?.logoAssetId) {
      const asset = await tx.mediaAsset.findFirst({
        where: { id: profile.logoAssetId },
        select: { url: true },
      });
      logoUrl = asset?.url ?? null;
    }
    const addressLine =
      [profile?.addressLine1, profile?.city, profile?.region].filter(Boolean).join(', ') || null;
    return {
      name: school?.name ?? 'School',
      logoUrl,
      addressLine,
      phone: profile?.phone ?? null,
      email: profile?.email ?? null,
    };
  }
}
