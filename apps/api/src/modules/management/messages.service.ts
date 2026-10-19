import { Injectable } from '@nestjs/common';
import { Prisma, withTenant, type TenantTx } from '@skoolos/db';
import {
  assertNotificationOutboxKind,
  type MessageableTeacher,
  type MessageBlockResult,
  type MessageReportResult,
  type MessageRow,
  type MessageThreadDetail,
  type MessageThreadRow,
  type MessageSenderRole,
  type NotificationOutboxKind,
  type UnreadCountResult,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import type {
  MessageReceivedOutboxPayload,
  MessageReportedOutboxPayload,
} from '../../common/notifications/notification.types';
import { resolveAdminRecipients } from '../../common/notifications/recipients';
import { emitNotifications } from '../../common/notifications/notification-inbox';
import { TenantContextService } from '../tenancy';
import { TimetableService } from './timetable.service';
import { LIST_CEILING } from '../../common/lists/list-ceiling';
import { unreadCountsByThread } from '../../common/lists/relation-counts';
import { requestOutboxDrain } from '../../common/notifications/outbox-signal';

const FALLBACK_SCHOOL_NAME = 'Your school';
const FALLBACK_SUBJECT_NAME = 'General';
const PREVIEW_LEN = 140;
const BLOCKED_MESSAGE = 'This conversation is blocked.';

/** Which side of a thread the caller is on. */
type Side = 'STUDENT' | 'TEACHER';

/** The two block columns on MessageThread (see the schema docstring). */
interface BlockColumns {
  blockedByStudentAt?: Date | null;
  blockedByTeacherAt?: Date | null;
}

/** `blockedByMe` / `blockedByOther` for the caller's side. */
function blockFlags(t: BlockColumns, side: Side): { blockedByMe: boolean; blockedByOther: boolean } {
  const student = t.blockedByStudentAt != null;
  const teacher = t.blockedByTeacherAt != null;
  return side === 'STUDENT'
    ? { blockedByMe: student, blockedByOther: teacher }
    : { blockedByMe: teacher, blockedByOther: student };
}

/** Nobody posts to a thread either side has blocked; the blocker can unblock. */
function assertNotBlocked(t: BlockColumns): void {
  if (t.blockedByStudentAt != null || t.blockedByTeacherAt != null) {
    throw new ApiError('THREAD_BLOCKED', BLOCKED_MESSAGE, 403, 'threadId');
  }
}

/**
 * Raw thread row shape with the includes both `toThreadRow` reads.
 *
 * `_count` is attached by us, not by Prisma. Asking Prisma for it aggregated
 * every message on the platform to render one school's inbox — see
 * relation-counts.ts.
 */
type ThreadWithRelations = Prisma.MessageThreadGetPayload<{
  include: {
    student: { select: { firstName: true; lastName: true } };
    teacher: { select: { firstName: true; lastName: true } };
    subject: { select: { name: true } };
    messages: { select: { body: true } };
  };
}> & { _count: { messages: number } };

function fullName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

/**
 * Messaging (Phase 4 Task 5 / item T17). Students message the teachers who
 * actually teach them; teachers reply. One thread per (student, teacher,
 * subject).
 *
 * THE LOAD-BEARING RULE: a student may only open/post to a teacher who holds a
 * timetable slot for the student's OWN section teaching that subject. This is
 * derived server-side from `TimetableService.listForClass` (each slot carries
 * `teacher.id` + `subject.id`), NEVER from client-supplied ids. A teacher only
 * ever sees/acts on threads whose stored `teacherId` = their own Teacher.id.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly timetable: TimetableService,
  ) {}

  // ── shared helpers ──────────────────────────────────────────────────────────

  private async myStudent(tx: TenantTx, userId: string) {
    const s = await tx.student.findFirst({
      where: { userId },
      select: { id: true, classSectionId: true, firstName: true, lastName: true },
    });
    if (!s) throw new ApiError('NOT_A_STUDENT', 'No student record for this login', 404);
    return s;
  }

  private async myTeacher(tx: TenantTx, userId: string) {
    const t = await tx.teacher.findFirst({
      where: { userId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!t) throw new ApiError('NOT_A_TEACHER', 'No teacher record for this login', 404);
    return t;
  }

  // ── unread totals (the drawer "Messages" badge) ──────────────────────────────

  /**
   * Total unread TEACHER→student messages across the student's threads — the
   * one number behind the student "Messages" badge. A single `count` with a
   * `thread` relation filter (index-backed by `Message.readAt`), never a
   * per-thread fan-out the client sums.
   */
  async studentUnreadCount(userId: string): Promise<UnreadCountResult> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const me = await this.myStudent(tx, userId);
      const count = await tx.message.count({
        where: { schoolId, senderRole: 'TEACHER', readAt: null, thread: { studentId: me.id } },
      });
      return { count };
    });
  }

  /** Total unread STUDENT→teacher messages across the teacher's threads. */
  async teacherUnreadCount(userId: string): Promise<UnreadCountResult> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const me = await this.myTeacher(tx, userId);
      const count = await tx.message.count({
        where: { schoolId, senderRole: 'STUDENT', readAt: null, thread: { teacherId: me.id } },
      });
      return { count };
    });
  }

  private static toMessageRow(m: {
    id: string;
    senderRole: string;
    body: string;
    createdAt: Date;
    readAt: Date | null;
  }): MessageRow {
    return {
      id: m.id,
      senderRole: m.senderRole as MessageSenderRole,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      readAt: m.readAt ? m.readAt.toISOString() : null,
    };
  }

  /** Maps a thread + its includes to the list row. `messages` is expected to
   * hold only the ONE newest message (for the preview); `_count.messages` is a
   * FILTERED count of the other party's unread messages (the include's where). */
  private static toThreadRow(t: ThreadWithRelations, side: Side): MessageThreadRow {
    return {
      id: t.id,
      studentId: t.studentId,
      studentName: fullName(t.student),
      teacherId: t.teacherId,
      teacherName: fullName(t.teacher),
      subjectId: t.subjectId,
      subjectName: t.subject?.name ?? FALLBACK_SUBJECT_NAME,
      lastMessageAt: t.lastMessageAt.toISOString(),
      lastMessagePreview: t.messages[0] ? t.messages[0].body.slice(0, PREVIEW_LEN) : null,
      unreadCount: t._count.messages,
      ...blockFlags(t, side),
    };
  }

  /** The include used for every thread-LIST query: names, the newest message
   * for a preview, and a filtered unread count. `unreadFrom` is the sender
   * whose unread messages the CALLER cares about (the OTHER party). */
  private static listInclude() {
    return {
      student: { select: { firstName: true, lastName: true } },
      teacher: { select: { firstName: true, lastName: true } },
      subject: { select: { name: true } },
      messages: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { body: true } },
    };
  }

  // ── student side (/me/messages) ─────────────────────────────────────────────

  /** The teachers this student may message: distinct (teacher, subject) pairs
   * from their own section's timetable. This IS the allow-list the send path
   * re-validates against — the student picks from here, never a free id. */
  async messageableTeachers(userId: string): Promise<MessageableTeacher[]> {
    const { schoolId } = this.tenant.requireTenant();
    const classSectionId = await withTenant(schoolId, async (tx) => {
      const s = await this.myStudent(tx, userId);
      return s.classSectionId;
    });
    if (!classSectionId) return [];

    const slots = await this.timetable.listForClass(schoolId, classSectionId);
    const byPair = new Map<string, MessageableTeacher>();
    for (const slot of slots) {
      const key = `${slot.teacher.id}:${slot.subject.id}`;
      if (!byPair.has(key)) {
        byPair.set(key, {
          teacherId: slot.teacher.id,
          teacherName: fullName(slot.teacher),
          subjectId: slot.subject.id,
          subjectName: slot.subject.name,
        });
      }
    }
    return [...byPair.values()].sort((a, b) =>
      a.teacherName.localeCompare(b.teacherName) || a.subjectName.localeCompare(b.subjectName),
    );
  }

  async studentThreads(userId: string): Promise<MessageThreadRow[]> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const s = await this.myStudent(tx, userId);
      const rows = await tx.messageThread.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, studentId: s.id },
        orderBy: { lastMessageAt: 'desc' },
        include: MessagesService.listInclude(),
      });
      const unread = await unreadCountsByThread(tx, schoolId, 'TEACHER');
      return rows.map((t) =>
        MessagesService.toThreadRow({ ...t, _count: { messages: unread.get(t.id) ?? 0 } }, 'STUDENT'),
      );
    });
  }

  /** Opens a thread the CALLER owns (studentId = them), returns its messages
   * chronological, and marks every TEACHER→student message read. */
  async studentThread(userId: string, threadId: string): Promise<MessageThreadDetail> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const s = await this.myStudent(tx, userId);
      const thread = await MessagesService.loadThreadForList(tx, schoolId, threadId, 'TEACHER');
      if (!thread || thread.studentId !== s.id) {
        throw new ApiError('NOT_FOUND', 'thread not found', 404, 'threadId');
      }
      await tx.message.updateMany({
        where: { schoolId, threadId, senderRole: 'TEACHER', readAt: null },
        data: { readAt: new Date() },
      });
      return MessagesService.detail(tx, thread, 'STUDENT');
    });
  }

  async studentSend(
    userId: string,
    dto: { teacherId: string; subjectId: string; body: string },
  ): Promise<MessageThreadDetail> {
    const { schoolId } = this.tenant.requireTenant();

    // Authorization: the (teacher, subject) pair MUST appear in this student's
    // own section timetable. Derived server-side; a forged teacherId/subjectId
    // that the student is not taught by is a 403 (proved by the deletion test).
    const allowed = await this.messageableTeachers(userId);
    const ok = allowed.some((a) => a.teacherId === dto.teacherId && a.subjectId === dto.subjectId);
    if (!ok) {
      throw new ApiError(
        'NOT_YOUR_TEACHER',
        'You can only message a teacher who teaches you this subject.',
        403,
        'teacherId',
      );
    }

    const sent = await withTenant(schoolId, async (tx) => {
      const s = await this.myStudent(tx, userId);
      if (!s.classSectionId) {
        throw new ApiError('NO_CLASS_SECTION', 'You are not in a class section yet.', 409);
      }
      const thread = await tx.messageThread.upsert({
        where: {
          one_thread_per_student_teacher_subject: {
            studentId: s.id,
            teacherId: dto.teacherId,
            subjectId: dto.subjectId,
          },
        },
        create: {
          schoolId,
          studentId: s.id,
          teacherId: dto.teacherId,
          subjectId: dto.subjectId,
          classSectionId: s.classSectionId,
        },
        update: {},
      });
      // Blocked by either side → nobody posts. Throwing here rolls the
      // transaction back (a thread that was just created cannot be blocked).
      assertNotBlocked(thread);

      await MessagesService.appendAndNotify(tx, {
        schoolId,
        thread,
        senderRole: 'STUDENT',
        body: dto.body,
        senderName: fullName(s),
        // Push targets the teacher's login.
        targetUserId: await MessagesService.teacherUserId(tx, dto.teacherId),
      });

      const fresh = await MessagesService.loadThreadForList(tx, schoolId, thread.id, 'TEACHER');
      return MessagesService.detail(tx, fresh!, 'STUDENT');
    });

    // Ask for a drain now rather than waiting for the daily cron — a message
    // that lands tomorrow is not a message. Claim-safe (FOR UPDATE SKIP LOCKED).
    requestOutboxDrain();
    return sent;
  }

  // ── teacher side (/manage/messages) ─────────────────────────────────────────

  async teacherThreads(userId: string): Promise<MessageThreadRow[]> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const t = await this.myTeacher(tx, userId);
      const rows = await tx.messageThread.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId, teacherId: t.id },
        orderBy: { lastMessageAt: 'desc' },
        include: MessagesService.listInclude(),
      });
      const unread = await unreadCountsByThread(tx, schoolId, 'STUDENT');
      return rows.map((t) =>
        MessagesService.toThreadRow({ ...t, _count: { messages: unread.get(t.id) ?? 0 } }, 'TEACHER'),
      );
    });
  }

  async teacherThread(userId: string, threadId: string): Promise<MessageThreadDetail> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const t = await this.myTeacher(tx, userId);
      const thread = await MessagesService.loadThreadForList(tx, schoolId, threadId, 'STUDENT');
      if (!thread || thread.teacherId !== t.id) {
        throw new ApiError('NOT_FOUND', 'thread not found', 404, 'threadId');
      }
      await tx.message.updateMany({
        where: { schoolId, threadId, senderRole: 'STUDENT', readAt: null },
        data: { readAt: new Date() },
      });
      return MessagesService.detail(tx, thread, 'TEACHER');
    });
  }

  async teacherReply(
    userId: string,
    threadId: string,
    dto: { body: string },
  ): Promise<MessageThreadDetail> {
    const { schoolId } = this.tenant.requireTenant();
    const out = await withTenant(schoolId, async (tx) => {
      const t = await this.myTeacher(tx, userId);
      // Ownership from the STORED thread, never caller input: a teacher may
      // only post to a thread whose teacherId is their own (403 otherwise).
      const thread = await tx.messageThread.findFirst({ where: { schoolId, id: threadId } });
      if (!thread || thread.teacherId !== t.id) {
        throw new ApiError('NOT_YOUR_THREAD', 'Thread not found', 404, 'threadId');
      }
      assertNotBlocked(thread);

      await MessagesService.appendAndNotify(tx, {
        schoolId,
        thread,
        senderRole: 'TEACHER',
        body: dto.body,
        senderName: fullName(t),
        // Push targets the student's login.
        targetUserId: await MessagesService.studentUserId(tx, thread.studentId),
      });

      const fresh = await MessagesService.loadThreadForList(tx, schoolId, thread.id, 'STUDENT');
      return MessagesService.detail(tx, fresh!, 'TEACHER');
    });
    requestOutboxDrain();
    return out;
  }

  // ── report & block (Google Play UGC policy) ─────────────────────────────────
  //
  // Only a participant may report or block: the teacher whose stored
  // `teacherId` is theirs, the student whose stored `studentId` is theirs.
  // Anyone else gets the SAME 404 the get-thread endpoints give, so a report
  // or block is never an oracle for whether a thread id exists.

  /** The thread, if the caller is on the given side of it; 404 otherwise. */
  private async participantThread(tx: TenantTx, schoolId: string, userId: string, threadId: string, side: Side) {
    const me = side === 'STUDENT' ? await this.myStudent(tx, userId) : await this.myTeacher(tx, userId);
    const thread = await tx.messageThread.findFirst({
      where: { schoolId, id: threadId },
      include: {
        student: { select: { firstName: true, lastName: true } },
        teacher: { select: { firstName: true, lastName: true } },
        subject: { select: { name: true } },
      },
    });
    const mine = thread && (side === 'STUDENT' ? thread.studentId === me.id : thread.teacherId === me.id);
    if (!thread || !mine) throw new ApiError('NOT_FOUND', 'thread not found', 404, 'threadId');
    return thread;
  }

  async teacherReport(userId: string, threadId: string, dto: { reason: string; messageId?: string }): Promise<MessageReportResult> {
    return this.report(userId, threadId, dto, 'TEACHER');
  }

  async studentReport(userId: string, threadId: string, dto: { reason: string; messageId?: string }): Promise<MessageReportResult> {
    return this.report(userId, threadId, dto, 'STUDENT');
  }

  async teacherBlock(userId: string, threadId: string, blocked: boolean): Promise<MessageBlockResult> {
    return this.block(userId, threadId, blocked, 'TEACHER');
  }

  async studentBlock(userId: string, threadId: string, blocked: boolean): Promise<MessageBlockResult> {
    return this.block(userId, threadId, blocked, 'STUDENT');
  }

  /**
   * Persists a MessageReport, then tells every active school admin (in-app
   * bell + one outbox row each, kind MESSAGE_REPORTED). The report is written
   * first in its own transaction; the notification runs after it and never
   * undoes it — the Complaint Box's rule: a notice that fails must not lose
   * the thing it describes.
   */
  private async report(
    userId: string,
    threadId: string,
    dto: { reason: string; messageId?: string },
    side: Side,
  ): Promise<MessageReportResult> {
    const { schoolId } = this.tenant.requireTenant();
    const reason = dto.reason.trim();
    if (!reason) throw new ApiError('REASON_REQUIRED', 'Say what is wrong with this conversation.', 400, 'reason');

    const saved = await withTenant(schoolId, async (tx) => {
      const thread = await this.participantThread(tx, schoolId, userId, threadId, side);
      if (dto.messageId) {
        const msg = await tx.message.findFirst({
          where: { schoolId, id: dto.messageId, threadId: thread.id },
          select: { id: true },
        });
        if (!msg) throw new ApiError('MESSAGE_NOT_FOUND', 'message not found', 404, 'messageId');
      }
      const row = await tx.messageReport.create({
        data: {
          schoolId,
          threadId: thread.id,
          messageId: dto.messageId ?? null,
          reporterUserId: userId,
          reporterRole: side,
          reason,
        },
        select: { id: true },
      });
      const reporter = side === 'STUDENT' ? fullName(thread.student) : fullName(thread.teacher);
      const other = side === 'STUDENT' ? fullName(thread.teacher) : fullName(thread.student);
      const subject = thread.subject?.name ?? FALLBACK_SUBJECT_NAME;
      return { reportId: row.id, reporter, other, subject };
    });

    await this.notifyReport(schoolId, threadId, reason, saved);
    return { ok: true };
  }

  private async notifyReport(
    schoolId: string,
    threadId: string,
    reason: string,
    r: { reportId: string; reporter: string; other: string; subject: string },
  ): Promise<void> {
    try {
      await withTenant(schoolId, async (tx) => {
        const [admins, school] = await Promise.all([
          resolveAdminRecipients(tx, schoolId),
          tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
        ]);
        if (admins.length === 0) return;
        const title = 'A message was reported';
        const body = `${r.reporter} reported a conversation with ${r.other} (${r.subject}): ${reason}`.slice(0, PREVIEW_LEN);
        await emitNotifications(tx, {
          schoolId,
          userIds: admins.map((a) => a.userId),
          kind: 'MESSAGE_REPORTED',
          title,
          body,
          linkType: 'message_report',
          linkId: r.reportId,
        });
        const kind: NotificationOutboxKind = 'MESSAGE_REPORTED';
        assertNotificationOutboxKind(kind);
        const payload: MessageReportedOutboxPayload = {
          schoolName: school?.name ?? FALLBACK_SCHOOL_NAME,
          title,
          body,
          threadId,
          reportId: r.reportId,
        };
        for (const a of admins) {
          await tx.notificationOutbox.create({
            data: { schoolId, kind, targetUserId: a.userId, payload: payload as unknown as Prisma.InputJsonValue },
            select: { id: true },
          });
        }
      });
      requestOutboxDrain();
    } catch {
      /* a notification must never undo the report it describes */
    }
  }

  /** Sets (or clears) the CALLER's side's block column. Idempotent: blocking
   * an already-blocked thread keeps the first timestamp. */
  private async block(userId: string, threadId: string, blocked: boolean, side: Side): Promise<MessageBlockResult> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const thread = await this.participantThread(tx, schoolId, userId, threadId, side);
      const column = side === 'STUDENT' ? 'blockedByStudentAt' : 'blockedByTeacherAt';
      const value = blocked ? (thread[column] ?? new Date()) : null;
      await tx.messageThread.update({ where: { id: thread.id }, data: { [column]: value } });
      return { blocked };
    });
  }

  // ── shared write path ────────────────────────────────────────────────────────

  /**
   * Appends a message, bumps `lastMessageAt`, and — IN THE SAME TRANSACTION —
   * writes one `NotificationOutbox` row (kind MESSAGE_RECEIVED) targeting the
   * recipient's login, so a message and its push row are all-or-nothing (the
   * rollback test proves it). The row is skipped only when the recipient has no
   * login at all (`targetUserId` null) — there is nobody to push to, and a
   * null-target row would wrongly fall into the section-broadcast path.
   */
  private static async appendAndNotify(
    tx: TenantTx,
    args: {
      schoolId: string;
      thread: { id: string; classSectionId: string; subjectId: string };
      senderRole: MessageSenderRole;
      body: string;
      senderName: string;
      targetUserId: string | null;
    },
  ): Promise<void> {
    const { schoolId, thread } = args;
    await tx.message.create({
      data: { schoolId, threadId: thread.id, senderRole: args.senderRole, body: args.body },
    });
    await tx.messageThread.update({
      where: { id: thread.id },
      data: { lastMessageAt: new Date() },
    });

    if (!args.targetUserId) return;

    const [school, subject] = await Promise.all([
      tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
      tx.subject.findFirst({ where: { id: thread.subjectId, schoolId }, select: { name: true } }),
    ]);
    const kind: NotificationOutboxKind = 'MESSAGE_RECEIVED';
    assertNotificationOutboxKind(kind);
    const payload: MessageReceivedOutboxPayload = {
      schoolName: school?.name ?? FALLBACK_SCHOOL_NAME,
      senderName: args.senderName,
      subjectName: subject?.name ?? FALLBACK_SUBJECT_NAME,
      preview: args.body.slice(0, PREVIEW_LEN),
      threadId: thread.id,
    };
    await tx.notificationOutbox.create({
      data: {
        schoolId,
        kind,
        classSectionId: thread.classSectionId,
        targetUserId: args.targetUserId,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // In-app inbox row (the bell) for the same recipient, in the SAME
    // transaction as the message + outbox row above — all-or-nothing.
    await emitNotifications(tx, {
      schoolId,
      userIds: [args.targetUserId],
      kind: 'MESSAGE',
      title: `New message from ${args.senderName}`,
      body: args.body.slice(0, PREVIEW_LEN),
      linkType: 'thread',
      linkId: thread.id,
    });
  }

  private static async teacherUserId(tx: TenantTx, teacherId: string): Promise<string | null> {
    const t = await tx.teacher.findFirst({ where: { id: teacherId }, select: { userId: true } });
    return t?.userId ?? null;
  }

  private static async studentUserId(tx: TenantTx, studentId: string): Promise<string | null> {
    const s = await tx.student.findFirst({ where: { id: studentId }, select: { userId: true } });
    return s?.userId ?? null;
  }

  private static async loadThreadForList(
    tx: TenantTx,
    schoolId: string,
    threadId: string,
    unreadFrom: MessageSenderRole,
  ): Promise<ThreadWithRelations | null> {
    const thread = await tx.messageThread.findFirst({
      where: { id: threadId },
      include: MessagesService.listInclude(),
    });
    if (!thread) return null;
    const messages = await tx.message.count({
      where: { schoolId, threadId, senderRole: unreadFrom, readAt: null },
    });
    return { ...thread, _count: { messages } };
  }

  /** Builds a full `MessageThreadDetail` (row + chronological messages) — read
   * AFTER any read-marking so `readAt` reflects the just-opened state. */
  private static async detail(
    tx: TenantTx,
    thread: ThreadWithRelations,
    side: Side,
  ): Promise<MessageThreadDetail> {
    const messages = await tx.message.findMany({ take: LIST_CEILING.ACTIVITY,
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      thread: MessagesService.toThreadRow(thread, side),
      messages: messages.map(MessagesService.toMessageRow),
    };
  }
}
