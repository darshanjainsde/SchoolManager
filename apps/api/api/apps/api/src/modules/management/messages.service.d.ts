import { type MessageableTeacher, type MessageThreadDetail, type MessageThreadRow, type UnreadCountResult } from '@skoolos/types';
import { TenantContextService } from '../tenancy';
import { TimetableService } from './timetable.service';
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
export declare class MessagesService {
    private readonly tenant;
    private readonly timetable;
    constructor(tenant: TenantContextService, timetable: TimetableService);
    private myStudent;
    private myTeacher;
    /**
     * Total unread TEACHER→student messages across the student's threads — the
     * one number behind the student "Messages" badge. A single `count` with a
     * `thread` relation filter (index-backed by `Message.readAt`), never a
     * per-thread fan-out the client sums.
     */
    studentUnreadCount(userId: string): Promise<UnreadCountResult>;
    /** Total unread STUDENT→teacher messages across the teacher's threads. */
    teacherUnreadCount(userId: string): Promise<UnreadCountResult>;
    private static toMessageRow;
    /** Maps a thread + its includes to the list row. `messages` is expected to
     * hold only the ONE newest message (for the preview); `_count.messages` is a
     * FILTERED count of the other party's unread messages (the include's where). */
    private static toThreadRow;
    /** The include used for every thread-LIST query: names, the newest message
     * for a preview, and a filtered unread count. `unreadFrom` is the sender
     * whose unread messages the CALLER cares about (the OTHER party). */
    private static listInclude;
    /** The teachers this student may message: distinct (teacher, subject) pairs
     * from their own section's timetable. This IS the allow-list the send path
     * re-validates against — the student picks from here, never a free id. */
    messageableTeachers(userId: string): Promise<MessageableTeacher[]>;
    studentThreads(userId: string): Promise<MessageThreadRow[]>;
    /** Opens a thread the CALLER owns (studentId = them), returns its messages
     * chronological, and marks every TEACHER→student message read. */
    studentThread(userId: string, threadId: string): Promise<MessageThreadDetail>;
    studentSend(userId: string, dto: {
        teacherId: string;
        subjectId: string;
        body: string;
    }): Promise<MessageThreadDetail>;
    teacherThreads(userId: string): Promise<MessageThreadRow[]>;
    teacherThread(userId: string, threadId: string): Promise<MessageThreadDetail>;
    teacherReply(userId: string, threadId: string, dto: {
        body: string;
    }): Promise<MessageThreadDetail>;
    /**
     * Appends a message, bumps `lastMessageAt`, and — IN THE SAME TRANSACTION —
     * writes one `NotificationOutbox` row (kind MESSAGE_RECEIVED) targeting the
     * recipient's login, so a message and its push row are all-or-nothing (the
     * rollback test proves it). The row is skipped only when the recipient has no
     * login at all (`targetUserId` null) — there is nobody to push to, and a
     * null-target row would wrongly fall into the section-broadcast path.
     */
    private static appendAndNotify;
    private static teacherUserId;
    private static studentUserId;
    private static loadThreadForList;
    /** Builds a full `MessageThreadDetail` (row + chronological messages) — read
     * AFTER any read-marking so `readAt` reflects the just-opened state. */
    private static detail;
}
//# sourceMappingURL=messages.service.d.ts.map