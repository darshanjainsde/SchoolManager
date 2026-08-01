import { Injectable } from '@nestjs/common';
import { Prisma, withTenant, type TenantTx } from '@skoolos/db';
import {
  assertNotificationOutboxKind,
  type MessageableTeacher,
  type MessageRow,
  type MessageThreadDetail,
  type MessageThreadRow,
  type MessageSenderRole,
  type NotificationOutboxKind,
  type UnreadCountResult,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import type { MessageReceivedOutboxPayload } from '../../common/notifications/notification.types';
import { emitNotifications } from '../../common/notifications/notification-inbox';
import { TenantContextService } from '../tenancy';
import { TimetableService } from './timetable.service';

const FALLBACK_SCHOOL_NAME = 'Your school';
const FALLBACK_SUBJECT_NAME = 'General';
const PREVIEW_LEN = 140;

/** Raw thread row shape with the includes both `toThreadRow` reads. */
type ThreadWithRelations = Prisma.MessageThreadGetPayload<{
  include: {
    student: { select: { firstName: true; lastName: true } };
    teacher: { select: { firstName: true; lastName: true } };
    subject: { select: { name: true } };
    messages: { select: { body: true } };
    _count: { select: { messages: true } };
  };
}>;

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
        where: { senderRole: 'TEACHER', readAt: null, thread: { studentId: me.id } },
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
        where: { senderRole: 'STUDENT', readAt: null, thread: { teacherId: me.id } },
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
  private static toThreadRow(t: ThreadWithRelations): MessageThreadRow {
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
    };
  }

  /** The include used for every thread-LIST query: names, the newest message
   * for a preview, and a filtered unread count. `unreadFrom` is the sender
   * whose unread messages the CALLER cares about (the OTHER party). */
  private static listInclude(unreadFrom: MessageSenderRole) {
    return {
      student: { select: { firstName: true, lastName: true } },
      teacher: { select: { firstName: true, lastName: true } },
      subject: { select: { name: true } },
      messages: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { body: true } },
      _count: { select: { messages: { where: { senderRole: unreadFrom, readAt: null } } } },
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
      const rows = await tx.messageThread.findMany({
        where: { studentId: s.id },
        orderBy: { lastMessageAt: 'desc' },
        include: MessagesService.listInclude('TEACHER'),
      });
      return rows.map(MessagesService.toThreadRow);
    });
  }

  /** Opens a thread the CALLER owns (studentId = them), returns its messages
   * chronological, and marks every TEACHER→student message read. */
  async studentThread(userId: string, threadId: string): Promise<MessageThreadDetail> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const s = await this.myStudent(tx, userId);
      const thread = await MessagesService.loadThreadForList(tx, threadId, 'TEACHER');
      if (!thread || thread.studentId !== s.id) {
        throw new ApiError('NOT_FOUND', 'thread not found', 404, 'threadId');
      }
      await tx.message.updateMany({
        where: { threadId, senderRole: 'TEACHER', readAt: null },
        data: { readAt: new Date() },
      });
      return MessagesService.detail(tx, thread);
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

    return withTenant(schoolId, async (tx) => {
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

      await MessagesService.appendAndNotify(tx, {
        schoolId,
        thread,
        senderRole: 'STUDENT',
        body: dto.body,
        senderName: fullName(s),
        // Push targets the teacher's login.
        targetUserId: await MessagesService.teacherUserId(tx, dto.teacherId),
      });

      const fresh = await MessagesService.loadThreadForList(tx, thread.id, 'TEACHER');
      return MessagesService.detail(tx, fresh!);
    });
  }

  // ── teacher side (/manage/messages) ─────────────────────────────────────────

  async teacherThreads(userId: string): Promise<MessageThreadRow[]> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const t = await this.myTeacher(tx, userId);
      const rows = await tx.messageThread.findMany({
        where: { teacherId: t.id },
        orderBy: { lastMessageAt: 'desc' },
        include: MessagesService.listInclude('STUDENT'),
      });
      return rows.map(MessagesService.toThreadRow);
    });
  }

  async teacherThread(userId: string, threadId: string): Promise<MessageThreadDetail> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const t = await this.myTeacher(tx, userId);
      const thread = await MessagesService.loadThreadForList(tx, threadId, 'STUDENT');
      if (!thread || thread.teacherId !== t.id) {
        throw new ApiError('NOT_FOUND', 'thread not found', 404, 'threadId');
      }
      await tx.message.updateMany({
        where: { threadId, senderRole: 'STUDENT', readAt: null },
        data: { readAt: new Date() },
      });
      return MessagesService.detail(tx, thread);
    });
  }

  async teacherReply(
    userId: string,
    threadId: string,
    dto: { body: string },
  ): Promise<MessageThreadDetail> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const t = await this.myTeacher(tx, userId);
      // Ownership from the STORED thread, never caller input: a teacher may
      // only post to a thread whose teacherId is their own (403 otherwise).
      const thread = await tx.messageThread.findFirst({ where: { id: threadId } });
      if (!thread || thread.teacherId !== t.id) {
        throw new ApiError('NOT_YOUR_THREAD', 'Thread not found', 404, 'threadId');
      }

      await MessagesService.appendAndNotify(tx, {
        schoolId,
        thread,
        senderRole: 'TEACHER',
        body: dto.body,
        senderName: fullName(t),
        // Push targets the student's login.
        targetUserId: await MessagesService.studentUserId(tx, thread.studentId),
      });

      const fresh = await MessagesService.loadThreadForList(tx, thread.id, 'STUDENT');
      return MessagesService.detail(tx, fresh!);
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

  private static loadThreadForList(tx: TenantTx, threadId: string, unreadFrom: MessageSenderRole) {
    return tx.messageThread.findFirst({
      where: { id: threadId },
      include: MessagesService.listInclude(unreadFrom),
    });
  }

  /** Builds a full `MessageThreadDetail` (row + chronological messages) — read
   * AFTER any read-marking so `readAt` reflects the just-opened state. */
  private static async detail(
    tx: TenantTx,
    thread: ThreadWithRelations,
  ): Promise<MessageThreadDetail> {
    const messages = await tx.message.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      thread: MessagesService.toThreadRow(thread),
      messages: messages.map(MessagesService.toMessageRow),
    };
  }
}
