import { Injectable, Logger } from '@nestjs/common';
import { withTenant, type TenantTx } from '@skoolos/db';
import type {
  DiaryEntryRow,
  DiaryPageResult,
  DiarySignResult,
  StudentDiaryEntry,
  StudentDiaryResult,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { assertTenantOwned } from '../../common/tenancy/assert-tenant-owned';
import { formatDateIST } from '../../common/notifications/format';
import { emitNotifications } from '../../common/notifications/notification-inbox';
import { NotificationService } from '../../common/notifications/notification.service';
import { resolveStudentRecipients } from '../../common/notifications/recipients';
import { runInBackground } from '../../common/notifications/run-in-background';
import { requireClassAccess } from './internal/class-access';
import { istTodayISO } from './internal/timetable-date';
import type { CreateDiaryEntryDto, UpdateDiaryEntryDto } from './management.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** How far back a family's undated diary request reaches. */
const STUDENT_WINDOW_DAYS = 30;

/** Never let a missing School row render as `undefined` in a parent's inbox. */
const FALLBACK_SCHOOL_NAME = 'Your school';

type Tx = TenantTx;

/**
 * The Daily Diary — the paper diary a child carries home, made digital.
 *
 * A teacher writes ITEMs (homework, "bring your art file") and REMARKs (the
 * red-ink note a parent signs) against one (class, date) page. Either kind
 * addresses the whole section (`audience: ALL`, no per-student rows) or a
 * typed-in shortlist (`audience: SELECTED`, one `DiaryRecipient` per child).
 *
 * Two rules carry the feature and are enforced HERE, not in any client:
 *
 *   1. A REMARK always reaches the parent by email, the moment it is written
 *      — a child signing it in the app does not, and cannot, replace that.
 *      The signature is an acknowledgement, not a substitute for telling the
 *      family (`create`'s post-commit fan-out).
 *   2. Today's page is ink that is still wet; a past page is read-only. Edits
 *      and deletes are refused once the day has turned (`assertToday`), so a
 *      diary a parent has already read cannot be quietly rewritten.
 *
 * Deliberately separate from `ClassNotesService`: those notes are a teachers'
 * handover log for a (class, date, subject) and are never shown to a family.
 * A diary entry exists to be read at home.
 */
@Injectable()
export class DiaryService {
  private readonly logger = new Logger(DiaryService.name);

  constructor(private readonly notifications: NotificationService) {}

  private assertDate(date: string): Date {
    if (!DATE_RE.test(date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }
    return new Date(date);
  }

  /**
   * Today's page is editable; a past one is closed ink. SCHOOL_ADMIN is NOT
   * exempted — unlike reopening a register (an admin's call to grant), a diary
   * line is the teacher's own words to a family, and rewriting yesterday's
   * after a parent has read it is exactly what this rule exists to prevent.
   */
  private assertToday(date: Date, action: string): void {
    if (date.toISOString().slice(0, 10) !== istTodayISO()) {
      throw new ApiError(
        'VALIDATION',
        `Only today's diary can be ${action} — earlier pages are read-only.`,
        409,
        'date',
      );
    }
  }

  /** Teacher display names for a set of Teacher.ids, in one query. */
  private async teacherNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const teachers = await tx.teacher.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(teachers.map((t) => [t.id, `${t.firstName} ${t.lastName}`.trim()]));
  }

  /**
   * One class's diary page for one day, as the TEACHER sees it — every entry
   * with its named children and its read/signature receipts.
   */
  async page(
    schoolId: string,
    classSectionId: string,
    date: string,
    userId: string,
    role: string,
  ): Promise<DiaryPageResult> {
    const day = this.assertDate(date);

    return withTenant(schoolId, async (tx) => {
      // A teacher may only open the diary of a class they hold that day; an
      // admin may open any of their school's. Same gate as the register.
      if (role !== 'SCHOOL_ADMIN') {
        await requireClassAccess(tx, userId, classSectionId, date, 'open the diary of');
      }

      const section = await tx.classSection.findFirst({
        where: { schoolId, id: classSectionId },
        select: { name: true, grade: { select: { name: true } }, _count: { select: { students: true } } },
      });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }

      const entries = await tx.diaryEntry.findMany({
        where: { schoolId, classSectionId, date: day },
        orderBy: { createdAt: 'asc' },
        include: {
          subject: { select: { name: true } },
          recipients: {
            select: { student: { select: { id: true, firstName: true, lastName: true } } },
          },
          acks: { select: { seenAt: true, signedAt: true } },
        },
      });

      const names = await this.teacherNames(tx, entries.map((e) => e.authorTeacherId));
      const editable = date === istTodayISO();
      const rosterCount = section._count.students;

      return {
        date,
        classSectionId,
        className: `${section.grade.name}-${section.name}`,
        entries: entries.map((e) => ({
          id: e.id,
          date,
          kind: e.kind,
          audience: e.audience,
          body: e.body,
          subjectId: e.subjectId,
          subjectName: e.subject?.name ?? null,
          authorTeacherId: e.authorTeacherId,
          authorName: names.get(e.authorTeacherId) ?? 'A teacher',
          students: e.recipients.map((r) => ({
            studentId: r.student.id,
            name: `${r.student.firstName} ${r.student.lastName}`.trim(),
          })),
          seenCount: e.acks.length,
          signedCount: e.acks.filter((a) => a.signedAt !== null).length,
          recipientCount: e.audience === 'SELECTED' ? e.recipients.length : rosterCount,
          createdAt: e.createdAt.toISOString(),
          editable,
        })),
      };
    });
  }

  /**
   * Writes one diary line. A REMARK must name at least one child (there is no
   * such thing as a remark about everybody), and every named child must
   * actually be on this section's roster — the same enrolment check the
   * register does, for the same reason: knowing a studentId must not be
   * enough to write into another class's diary.
   */
  async create(
    schoolId: string,
    userId: string,
    role: string,
    dto: CreateDiaryEntryDto,
  ): Promise<DiaryEntryRow> {
    const day = this.assertDate(dto.date);
    const body = dto.body.trim();
    if (!body) throw new ApiError('VALIDATION', 'A diary entry cannot be empty.', 400, 'body');
    this.assertToday(day, 'written');

    const audience = dto.kind === 'REMARK' ? 'SELECTED' : (dto.audience ?? 'ALL');
    const studentIds = [...new Set(dto.studentIds ?? [])];
    if (audience === 'SELECTED' && studentIds.length === 0) {
      throw new ApiError(
        'VALIDATION',
        dto.kind === 'REMARK'
          ? 'A remark has to be about someone — choose at least one student.'
          : 'Choose at least one student, or address the whole class.',
        400,
        'studentIds',
      );
    }

    const created = await withTenant(schoolId, async (tx) => {
      const teacherId =
        role === 'SCHOOL_ADMIN'
          ? ((await tx.teacher.findFirst({ where: { userId }, select: { id: true } }))?.id ?? null)
          : await requireClassAccess(tx, userId, dto.classSectionId, dto.date, 'write in the diary of');

      const section = await tx.classSection.findFirst({
        where: { schoolId, id: dto.classSectionId },
        select: { name: true, grade: { select: { name: true } }, _count: { select: { students: true } } },
      });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }
      // An admin with no Teacher row still has to be attributable; there is no
      // Teacher.id to store, so refuse rather than write an unattributed line.
      if (!teacherId) {
        throw new ApiError(
          'CLASS_NOT_OWNED',
          'Only a teacher account can write in a class diary.',
          403,
        );
      }

      let named: { id: string; firstName: string; lastName: string }[] = [];
      if (studentIds.length > 0) {
        named = await tx.student.findMany({
          where: { schoolId, id: { in: studentIds }, classSectionId: dto.classSectionId },
          select: { id: true, firstName: true, lastName: true },
        });
        if (named.length !== studentIds.length) {
          throw new ApiError(
            'VALIDATION',
            'One or more students do not belong to this class section',
            400,
            'studentIds',
          );
        }
      }

      // `classSectionId` is already proven above (the caller must own it, and
      // the roster read is scoped to it). `subjectId` was not proven anywhere:
      // it went straight into the row, and the FK to Subject is checked
      // OUTSIDE row-level security, so another school's subject id would have
      // been accepted. See `assertTenantOwned`.
      await assertTenantOwned([{ field: 'subjectId', id: dto.subjectId, model: tx.subject }]);

      const entry = await tx.diaryEntry.create({
        data: {
          schoolId,
          classSectionId: dto.classSectionId,
          subjectId: dto.subjectId ?? null,
          date: day,
          kind: dto.kind,
          audience,
          body,
          authorTeacherId: teacherId,
          ...(named.length > 0
            ? {
                recipients: {
                  create: named.map((s) => ({ schoolId, studentId: s.id })),
                },
              }
            : {}),
        },
        include: { subject: { select: { name: true } } },
      });

      // The bell, in the same transaction as the entry — a diary line a family
      // is never told about is worse than no line at all.
      const recipientUserIds = await this.recipientUserIds(
        tx,
        schoolId,
        dto.classSectionId,
        audience === 'SELECTED' ? named.map((s) => s.id) : null,
      );
      await emitNotifications(tx, {
        schoolId,
        userIds: recipientUserIds,
        kind: 'DIARY',
        title: dto.kind === 'REMARK' ? 'A remark in your diary' : 'New diary entry',
        body: body.slice(0, 160),
        linkType: 'diary',
        linkId: entry.id,
      });

      const names = await this.teacherNames(tx, [teacherId]);
      const row: DiaryEntryRow = {
        id: entry.id,
        date: dto.date,
        kind: entry.kind,
        audience: entry.audience,
        body: entry.body,
        subjectId: entry.subjectId,
        subjectName: entry.subject?.name ?? null,
        authorTeacherId: teacherId,
        authorName: names.get(teacherId) ?? 'A teacher',
        students: named.map((s) => ({
          studentId: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
        })),
        seenCount: 0,
        signedCount: 0,
        recipientCount: audience === 'SELECTED' ? named.length : section._count.students,
        createdAt: entry.createdAt.toISOString(),
        editable: true,
      };
      return { row, className: `${section.grade.name}-${section.name}` };
    });

    if (created.row.kind === 'REMARK') {
      this.emailRemark(schoolId, created.row, created.className, day);
    }

    return created.row;
  }

  /**
   * The linked-login `User.id`s a diary entry is addressed to: the named
   * students for a SELECTED entry, the whole section for an ALL one. Students
   * without a login simply produce no recipient, never an error — the same
   * rule the push/email resolvers follow.
   */
  private async recipientUserIds(
    tx: Tx,
    schoolId: string,
    classSectionId: string,
    studentIds: string[] | null,
  ): Promise<string[]> {
    const students = await tx.student.findMany({
      where: {
        schoolId,
        userId: { not: null },
        ...(studentIds ? { id: { in: studentIds } } : { classSectionId }),
      },
      select: { userId: true },
    });
    return students.map((s) => s.userId).filter((id): id is string => Boolean(id));
  }

  /**
   * Rule 1, post-commit: the parent is told, in full, by email — always, and
   * regardless of whether the child ever opens the app. Best-effort like every
   * other notify() call site: a mail failure is logged, never surfaced to the
   * teacher who wrote the remark.
   */
  private emailRemark(schoolId: string, row: DiaryEntryRow, className: string, day: Date): void {
    const studentIds = row.students.map((s) => s.studentId);
    if (studentIds.length === 0) return;

    runInBackground(
      async () => {
        const { schoolName, recipients } = await withTenant(schoolId, async (tx) => {
          const school = await tx.school.findFirst({
            where: { id: schoolId },
            select: { name: true },
          });
          const recipients = await resolveStudentRecipients(tx, schoolId, studentIds);
          return { schoolName: school?.name ?? FALLBACK_SCHOOL_NAME, recipients };
        });
        if (recipients.length === 0) return;

        // One payload per recipient — each family's email names their own
        // child, never the others the same remark happened to cover.
        await this.notifications.notify(
          'DIARY_REMARK',
          recipients.map((r) => ({
            email: r.email,
            schoolId,
            payload: {
              schoolName,
              studentName: r.studentName,
              teacherName: row.authorName,
              className,
              date: formatDateIST(day),
              remark: row.body,
            },
          })),
        );
      },
      (e) => this.logger.error(`DIARY_REMARK notify failed: ${(e as Error).message}`),
    );
  }

  /** Corrects today's wording. Author-only: a diary line is someone's own words. */
  async update(
    schoolId: string,
    userId: string,
    role: string,
    id: string,
    dto: UpdateDiaryEntryDto,
  ): Promise<DiaryEntryRow> {
    const body = dto.body.trim();
    if (!body) throw new ApiError('VALIDATION', 'A diary entry cannot be empty.', 400, 'body');

    return withTenant(schoolId, async (tx) => {
      const existing = await this.requireOwnEntry(tx, schoolId, userId, role, id, 'edited');
      const date = existing.date.toISOString().slice(0, 10);
      const entry = await tx.diaryEntry.update({
        where: { id },
        data: { body },
        include: {
          subject: { select: { name: true } },
          recipients: {
            select: { student: { select: { id: true, firstName: true, lastName: true } } },
          },
          acks: { select: { seenAt: true, signedAt: true } },
          classSection: { select: { _count: { select: { students: true } } } },
        },
      });
      const names = await this.teacherNames(tx, [entry.authorTeacherId]);
      return {
        id: entry.id,
        date,
        kind: entry.kind,
        audience: entry.audience,
        body: entry.body,
        subjectId: entry.subjectId,
        subjectName: entry.subject?.name ?? null,
        authorTeacherId: entry.authorTeacherId,
        authorName: names.get(entry.authorTeacherId) ?? 'A teacher',
        students: entry.recipients.map((r) => ({
          studentId: r.student.id,
          name: `${r.student.firstName} ${r.student.lastName}`.trim(),
        })),
        seenCount: entry.acks.length,
        signedCount: entry.acks.filter((a) => a.signedAt !== null).length,
        recipientCount:
          entry.audience === 'SELECTED'
            ? entry.recipients.length
            : entry.classSection._count.students,
        createdAt: entry.createdAt.toISOString(),
        editable: true,
      };
    });
  }

  /** Strikes today's line out entirely. Author-only, today-only. */
  async remove(schoolId: string, userId: string, role: string, id: string): Promise<void> {
    await withTenant(schoolId, async (tx) => {
      await this.requireOwnEntry(tx, schoolId, userId, role, id, 'deleted');
      await tx.diaryEntry.delete({ where: { id } });
    });
  }

  /**
   * The shared gate for both mutations: the entry exists, it is still today's
   * ink, and the caller wrote it. A SCHOOL_ADMIN is not given a bypass here —
   * see `assertToday`; if a remark truly must go, the author strikes it out.
   */
  private async requireOwnEntry(
    tx: Tx,
    schoolId: string,
    userId: string,
    role: string,
    id: string,
    action: string,
  ) {
    const existing = await tx.diaryEntry.findFirst({ where: { schoolId, id } });
    if (!existing) throw new ApiError('NOT_FOUND', 'That diary entry no longer exists.', 404, 'id');
    this.assertToday(existing.date, action);

    const teacher = await tx.teacher.findFirst({ where: { schoolId, userId }, select: { id: true } });
    if (!teacher || teacher.id !== existing.authorTeacherId) {
      throw new ApiError(
        'CLASS_NOT_OWNED',
        `Only the teacher who wrote this entry can have it ${action}.`,
        403,
        'id',
      );
    }
    // `role` is deliberately unused for the ownership test — kept in the
    // signature so a future school-level policy has a place to land without
    // rewriting both call sites.
    void role;
    return existing;
  }

  // ── The family's side ──────────────────────────────────────────────────────

  /**
   * The child's own diary. `date` narrows to one page; without it, the last
   * `STUDENT_WINDOW_DAYS` days, newest first — the "flip back through the
   * week" view.
   *
   * Reading marks the page seen: a `DiaryAck` row is created for every entry
   * rendered (idempotent via `one_ack_per_entry_student`), which is what feeds
   * the teacher's "23 of 28 families have opened this" receipt.
   */
  async studentDiary(schoolId: string, userId: string, date?: string): Promise<StudentDiaryResult> {
    if (date) this.assertDate(date);

    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { schoolId, userId },
        select: { id: true, classSectionId: true },
      });
      if (!student?.classSectionId) return { entries: [], unsignedCount: 0 };

      const since = new Date();
      since.setDate(since.getDate() - STUDENT_WINDOW_DAYS);

      const entries = await tx.diaryEntry.findMany({
        where: { schoolId,
          classSectionId: student.classSectionId,
          ...(date ? { date: new Date(date) } : { date: { gte: since } }),
          // A SELECTED entry is only this child's business if they are named
          // on it; an ALL entry belongs to the whole section.
          OR: [{ audience: 'ALL' }, { recipients: { some: { studentId: student.id } } }],
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'asc' }],
        include: {
          subject: { select: { name: true } },
          acks: { where: { studentId: student.id }, select: { signedAt: true, signedName: true } },
          recipients: { where: { studentId: student.id }, select: { id: true } },
        },
      });

      const names = await this.teacherNames(tx, entries.map((e) => e.authorTeacherId));

      // Lazy read receipts. `skipDuplicates` makes re-opening the diary a
      // no-op rather than a unique-violation, and keeps the FIRST seenAt.
      if (entries.length > 0) {
        await tx.diaryAck.createMany({
          data: entries.map((e) => ({ schoolId, entryId: e.id, studentId: student.id })),
          skipDuplicates: true,
        });
      }

      const rows: StudentDiaryEntry[] = entries.map((e) => ({
        id: e.id,
        date: e.date.toISOString().slice(0, 10),
        kind: e.kind,
        body: e.body,
        subjectName: e.subject?.name ?? null,
        teacherName: names.get(e.authorTeacherId) ?? 'A teacher',
        personal: e.audience === 'SELECTED' && e.recipients.length > 0,
        signedAt: e.acks[0]?.signedAt?.toISOString() ?? null,
        signedName: e.acks[0]?.signedName ?? null,
        createdAt: e.createdAt.toISOString(),
      }));

      return {
        entries: rows,
        unsignedCount: rows.filter((r) => r.kind === 'REMARK' && !r.signedAt).length,
      };
    });
  }

  /**
   * The signature in the margin. Idempotent by design — re-signing keeps the
   * FIRST signature's timestamp and name, so a second tap can never overwrite
   * the record of who acknowledged the remark and when.
   */
  async sign(
    schoolId: string,
    userId: string,
    id: string,
    signedName: string,
  ): Promise<DiarySignResult> {
    const name = signedName.trim();
    if (!name) {
      throw new ApiError('VALIDATION', 'Type the name of whoever is signing.', 400, 'signedName');
    }

    return withTenant(schoolId, async (tx) => {
      const student = await tx.student.findFirst({
        where: { schoolId, userId },
        select: { id: true, classSectionId: true },
      });
      if (!student?.classSectionId) {
        throw new ApiError('NOT_FOUND', 'No student record for this login.', 404);
      }

      // Resolve the entry through THIS child's own visibility, never by id
      // alone — otherwise one student could sign another class's remark.
      const entry = await tx.diaryEntry.findFirst({
        where: { schoolId,
          id,
          classSectionId: student.classSectionId,
          OR: [{ audience: 'ALL' }, { recipients: { some: { studentId: student.id } } }],
        },
        select: { id: true },
      });
      if (!entry) {
        throw new ApiError('NOT_FOUND', 'That diary entry is not in your diary.', 404, 'id');
      }

      const existing = await tx.diaryAck.findFirst({
        where: { schoolId, entryId: id, studentId: student.id },
        select: { id: true, signedAt: true, signedName: true },
      });
      const signedAt = existing?.signedAt ?? new Date();
      const finalName = existing?.signedName ?? name;
      if (existing) {
        if (!existing.signedAt) {
          await tx.diaryAck.update({
            where: { id: existing.id },
            data: { signedAt, signedName: finalName },
          });
        }
      } else {
        await tx.diaryAck.create({
          data: { schoolId, entryId: id, studentId: student.id, signedAt, signedName: finalName },
        });
      }

      const since = new Date();
      since.setDate(since.getDate() - STUDENT_WINDOW_DAYS);
      const unsigned = await tx.diaryEntry.findMany({
        where: { schoolId,
          classSectionId: student.classSectionId,
          date: { gte: since },
          kind: 'REMARK',
          recipients: { some: { studentId: student.id } },
          acks: { none: { studentId: student.id, signedAt: { not: null } } },
        },
        select: { id: true },
      });

      return {
        id,
        signedAt: signedAt.toISOString(),
        signedName: finalName,
        unsignedCount: unsigned.length,
      };
    });
  }
}
