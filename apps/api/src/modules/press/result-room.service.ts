import { Injectable, Logger } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type {
  IssueReportCardsResponse, NudgeResultsResponse, ResultRoomBoard, ResultRoomClass, ResultRoomSubject,
} from '@skoolos/types';
import { AuditService } from '../../common/audit/audit.service';
import { ApiError } from '../../common/errors/api-error';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { emitNotifications } from '../../common/notifications/notification-inbox';
import { istDayStartUtc, istDayAfterUtc, ReportCardService } from './report-card.service';

/**
 * The Result Room — report-card generation gets a cockpit.
 *
 * One read answers, per class per subject: has the teacher entered marks, has
 * she published them, who is still unmarked, who was absent. Three states,
 * never two — "not entered", "entered but unpublished" and "child was AB" are
 * different facts with different fixes, and the room names each one.
 *
 * The generation GATE lives here too: a class generates when every subject is
 * published for every active child (missing rows = not ready; AB/EX rows ARE
 * data). A deliberate override stays possible — with a written reason that
 * lands in the audit log. The actual issuing delegates to the same
 * `issueBatch` everything else uses; the room adds judgement, not a second
 * code path.
 *
 * Readiness covers subjects that HAVE at least one exam in the window — the
 * system cannot know a subject was intended if nobody scheduled a test, so a
 * class with no exams is flagged as its own state rather than guessed at.
 */

const MISSING_NAMES_CAP = 8;
const ABSENTEE_CAP = 200;

@Injectable()
export class ResultRoomService {
  private readonly logger = new Logger(ResultRoomService.name);

  constructor(
    private readonly reportCards: ReportCardService,
    private readonly audit: AuditService,
  ) {}

  async board(schoolId: string, windowId?: string): Promise<ResultRoomBoard> {
    return withTenant(schoolId, async (tx) => {
      const windows = await tx.reportWindow.findMany({
        orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
        take: LIST_CEILING.STRUCTURE,
        include: { academicYear: { select: { name: true } } },
      });
      const chosen = (windowId ? windows.find((w) => w.id === windowId) : undefined) ?? windows[0];
      if (!chosen) return { window: null, classes: [], absentees: [] };

      const windowRow = {
        id: chosen.id,
        name: chosen.name,
        academicYearId: chosen.academicYearId,
        academicYearName: chosen.academicYear.name,
        startDate: chosen.startDate.toISOString().slice(0, 10),
        endDate: chosen.endDate.toISOString().slice(0, 10),
        resultDay: chosen.resultDay ? chosen.resultDay.toISOString().slice(0, 10) : null,
      };

      const [sections, roster, exams] = await Promise.all([
        tx.classSection.findMany({
          include: { grade: { select: { name: true, order: true } } },
          take: LIST_CEILING.STRUCTURE,
        }),
        tx.student.findMany({
          where: { isActive: true, classSectionId: { not: null } },
          select: { id: true, firstName: true, lastName: true, rollNo: true, classSectionId: true },
          take: LIST_CEILING.ROSTER,
        }),
        tx.exam.findMany({
          where: {
            scheduledAt: { gte: istDayStartUtc(chosen.startDate), lt: istDayAfterUtc(chosen.endDate) },
          },
          select: { id: true, classSectionId: true, subjectId: true, title: true, createdById: true },
          take: LIST_CEILING.ROSTER,
        }),
      ]);
      const examIds = exams.map((e) => e.id);

      const [results, subjects, teachers, issues, nudges] = await Promise.all([
        examIds.length
          ? tx.result.findMany({
              where: { examId: { in: examIds } },
              select: { examId: true, studentId: true, status: true, publishedAt: true },
              take: LIST_CEILING.ROSTER * 4,
            })
          : Promise.resolve([]),
        tx.subject.findMany({ select: { id: true, name: true }, take: LIST_CEILING.STRUCTURE }),
        tx.teacher.findMany({
          where: { userId: { not: null } },
          select: { userId: true, firstName: true, lastName: true },
          take: LIST_CEILING.STRUCTURE,
        }),
        tx.pressIssue.findMany({
          where: { type: 'REPORT_CARD', windowId: chosen.id, voidedAt: null },
          select: { student: { select: { classSectionId: true } } },
          take: LIST_CEILING.ROSTER,
        }),
        tx.resultNudge.findMany({
          where: { windowId: chosen.id },
          orderBy: { sentAt: 'desc' },
          take: LIST_CEILING.ACTIVITY,
        }),
      ]);

      const subjectName = new Map(subjects.map((x) => [x.id, x.name]));
      const teacherName = new Map(teachers.map((t) => [t.userId!, `${t.firstName} ${t.lastName}`.trim()]));
      const rosterBySection = new Map<string, typeof roster>();
      for (const st of roster) {
        const list = rosterBySection.get(st.classSectionId!) ?? [];
        list.push(st);
        rosterBySection.set(st.classSectionId!, list);
      }
      const issuedBySection = new Map<string, number>();
      for (const i of issues) {
        const cs = i.student.classSectionId;
        if (cs) issuedBySection.set(cs, (issuedBySection.get(cs) ?? 0) + 1);
      }
      const resultByExamStudent = new Map<string, { status: string; published: boolean }>();
      for (const r of results) {
        resultByExamStudent.set(`${r.examId}:${r.studentId}`, {
          status: r.status,
          published: r.publishedAt !== null,
        });
      }
      // Latest nudge per (class, subject) — the "nudged yesterday" memory.
      const lastNudge = new Map<string, { at: string; kind: 'ENTER' | 'PUBLISH' }>();
      for (const n of nudges) {
        const key = `${n.classSectionId}:${n.subjectId}`;
        if (!lastNudge.has(key)) {
          lastNudge.set(key, { at: n.sentAt.toISOString(), kind: n.kind as 'ENTER' | 'PUBLISH' });
        }
      }
      const examsBySection = new Map<string, typeof exams>();
      for (const e of exams) {
        const list = examsBySection.get(e.classSectionId) ?? [];
        list.push(e);
        examsBySection.set(e.classSectionId, list);
      }

      const absentees: ResultRoomBoard['absentees'] = [];
      const classes: ResultRoomClass[] = sections
        .sort((a, b) => a.grade.order - b.grade.order || a.grade.name.localeCompare(b.grade.name) || a.name.localeCompare(b.name))
        .map((sec) => {
          const label = `${sec.grade.name}-${sec.name}`;
          const kids = rosterBySection.get(sec.id) ?? [];
          const secExams = examsBySection.get(sec.id) ?? [];

          const bySubject = new Map<string, typeof secExams>();
          for (const e of secExams) {
            const list = bySubject.get(e.subjectId) ?? [];
            list.push(e);
            bySubject.set(e.subjectId, list);
          }

          const subjectRows: ResultRoomSubject[] = [...bySubject.entries()].map(([subjectId, subjExams]) => {
            let entered = 0;
            let published = 0;
            let abCount = 0;
            let exCount = 0;
            const missing = new Set<string>();
            for (const kid of kids) {
              for (const e of subjExams) {
                const r = resultByExamStudent.get(`${e.id}:${kid.id}`);
                if (!r) {
                  missing.add(`${kid.firstName} ${kid.lastName}`.trim());
                  continue;
                }
                entered += 1;
                if (r.published) published += 1;
                if (r.status === 'AB') {
                  abCount += 1;
                  if (absentees.length < ABSENTEE_CAP) {
                    absentees.push({
                      studentId: kid.id,
                      studentName: `${kid.firstName} ${kid.lastName}`.trim(),
                      classLabel: label,
                      subjectName: subjectName.get(subjectId) ?? '—',
                      examTitle: e.title,
                    });
                  }
                }
                if (r.status === 'EX') exCount += 1;
              }
            }
            const expected = kids.length * subjExams.length;
            const creator = subjExams.find((e) => teacherName.has(e.createdById))?.createdById
              ?? subjExams[0]?.createdById ?? null;
            const state: ResultRoomSubject['state'] =
              entered < expected ? 'MISSING' : published < expected ? 'ENTERED' : 'PUBLISHED';
            return {
              subjectId,
              subjectName: subjectName.get(subjectId) ?? '—',
              teacherUserId: creator,
              teacherName: creator ? teacherName.get(creator) ?? null : null,
              exams: subjExams.length,
              expected,
              entered,
              published,
              abCount,
              exCount,
              missingStudents: [...missing].slice(0, MISSING_NAMES_CAP),
              state,
              lastNudge: lastNudge.get(`${sec.id}:${subjectId}`) ?? null,
            };
          }).sort((a, b) => a.subjectName.localeCompare(b.subjectName));

          const ready =
            kids.length > 0 && subjectRows.length > 0 && subjectRows.every((r) => r.state === 'PUBLISHED');
          return {
            id: sec.id,
            label,
            students: kids.length,
            issued: issuedBySection.get(sec.id) ?? 0,
            ready,
            noExams: secExams.length === 0,
            subjects: subjectRows,
          };
        });

      return { window: windowRow, classes, absentees };
    });
  }

  /**
   * One tap → the subject teacher's bell (and the outbox's email drain).
   * Logged, so the room can show "nudged yesterday" and nobody nags twice.
   */
  async nudge(
    schoolId: string,
    input: { windowId: string; classSectionId: string; subjectId: string; kind: 'ENTER' | 'PUBLISH' },
    sentById: string,
  ): Promise<NudgeResultsResponse> {
    return withTenant(schoolId, async (tx) => {
      const window = await tx.reportWindow.findFirst({
        where: { id: input.windowId },
        select: { name: true, resultDay: true, startDate: true, endDate: true },
      });
      if (!window) throw new ApiError('NOT_FOUND', 'That report window was not found.', 404);
      const section = await tx.classSection.findFirst({
        where: { id: input.classSectionId },
        select: { name: true, grade: { select: { name: true } } },
      });
      if (!section) throw new ApiError('NOT_FOUND', 'That class was not found.', 404);
      const subject = await tx.subject.findFirst({
        where: { id: input.subjectId }, select: { name: true },
      });
      if (!subject) throw new ApiError('NOT_FOUND', 'That subject was not found.', 404);

      // The recipients: whoever created this subject's exams in the window.
      const exams = await tx.exam.findMany({
        where: {
          classSectionId: input.classSectionId,
          subjectId: input.subjectId,
          scheduledAt: { gte: istDayStartUtc(window.startDate), lt: istDayAfterUtc(window.endDate) },
        },
        select: { createdById: true },
      });
      const userIds = [...new Set(exams.map((e) => e.createdById))];
      if (userIds.length === 0) {
        throw new ApiError('NOT_FOUND', 'No exams in this window for that subject — nobody to nudge.', 404);
      }

      const classLabel = `${section.grade.name}-${section.name}`;
      const due = window.resultDay
        ? ` Result day is ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(window.resultDay)}.`
        : '';
      await emitNotifications(tx, {
        schoolId,
        userIds,
        kind: 'RESULTS_DUE',
        title: `${window.name} · ${subject.name} · ${classLabel}`,
        body: input.kind === 'PUBLISH'
          ? `Marks are entered but not published — publish them so report cards can go out.${due}`
          : `Some children are still unmarked — please enter the ${subject.name} scores.${due}`,
      });
      await tx.resultNudge.createMany({
        data: userIds.map((teacherUserId) => ({
          schoolId,
          windowId: input.windowId,
          classSectionId: input.classSectionId,
          subjectId: input.subjectId,
          teacherUserId,
          kind: input.kind,
          sentById,
        })),
      });

      const teachers = await tx.teacher.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, firstName: true, lastName: true },
      });
      const nameByUser = new Map(teachers.map((t) => [t.userId!, `${t.firstName} ${t.lastName}`.trim()]));
      this.logger.log({ schoolId, ...input, recipients: userIds.length }, 'results nudge sent');
      return { notified: userIds.map((id) => ({ teacherUserId: id, teacherName: nameByUser.get(id) ?? null })) };
    });
  }

  /**
   * The gate. Ready classes generate; an unready class needs a WRITTEN reason,
   * which lands in the audit log next to who signed it. The issuing itself is
   * the same issueBatch as everywhere — the room adds judgement, not a fork.
   */
  async generate(
    schoolId: string,
    input: { windowId: string; classSectionId: string; overrideNote?: string },
    userId: string,
  ): Promise<IssueReportCardsResponse> {
    const boardNow = await this.board(schoolId, input.windowId);
    const cls = boardNow.classes.find((c) => c.id === input.classSectionId);
    if (!cls) throw new ApiError('NOT_FOUND', 'That class was not found.', 404);

    if (!cls.ready) {
      const note = input.overrideNote?.trim();
      if (!note) {
        const pending = cls.noExams
          ? 'no tests are scheduled in this window'
          : cls.subjects
              .filter((r) => r.state !== 'PUBLISHED')
              .map((r) => `${r.subjectName} (${r.state === 'MISSING' ? 'marks missing' : 'not published'})`)
              .join(', ');
        throw new ApiError(
          'RESULTS_NOT_READY',
          `${cls.label} is not ready: ${pending}. Chase the marks, or generate anyway with a written reason — it goes on the record.`,
          409,
          'overrideNote',
        );
      }
      await this.audit.record({
        schoolId,
        actorUserId: userId,
        action: 'press.generate_with_gaps',
        entity: 'ReportWindow',
        entityId: input.windowId,
        meta: { classSectionId: input.classSectionId, classLabel: cls.label, note },
      });
      this.logger.warn({ schoolId, ...input }, 'report cards generated over an unready board');
    }

    return this.reportCards.issueBatch(
      schoolId,
      { windowId: input.windowId, classSectionId: input.classSectionId },
      userId,
    );
  }
}
