import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { MessagesService } from './messages.service';
import { StudentSendMessageDto } from './messages.dto';
/**
 * Student side of messaging (Phase 4 Task 5 / T17) — `/me/messages`. A student
 * may only message a teacher who teaches them (enforced in the service from the
 * timetable, never from these ids). Sends are rate-limited so one student can't
 * spam a teacher.
 */
export declare class StudentMessagesController {
    private readonly messages;
    constructor(messages: MessagesService);
    teachers(u: SchoolJwtPayload): Promise<import("@skoolos/types").MessageableTeacher[]>;
    unreadCount(u: SchoolJwtPayload): Promise<import("@skoolos/types").UnreadCountResult>;
    list(u: SchoolJwtPayload): Promise<import("@skoolos/types").MessageThreadRow[]>;
    thread(threadId: string, u: SchoolJwtPayload): Promise<import("@skoolos/types").MessageThreadDetail>;
    send(u: SchoolJwtPayload, dto: StudentSendMessageDto): Promise<import("@skoolos/types").MessageThreadDetail>;
}
//# sourceMappingURL=student-messages.controller.d.ts.map