import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { MessagesService } from './messages.service';
import { TeacherReplyDto } from './messages.dto';
/**
 * Teacher side of messaging (Phase 4 Task 5 / T17) — `/manage/messages`. A
 * teacher only ever sees/acts on threads whose stored `teacherId` is their own
 * (enforced in the service from the STORED thread, never caller input).
 */
export declare class TeacherMessagesController {
    private readonly messages;
    constructor(messages: MessagesService);
    list(u: SchoolJwtPayload): Promise<import("@skoolos/types").MessageThreadRow[]>;
    unreadCount(u: SchoolJwtPayload): Promise<import("@skoolos/types").UnreadCountResult>;
    thread(threadId: string, u: SchoolJwtPayload): Promise<import("@skoolos/types").MessageThreadDetail>;
    reply(threadId: string, u: SchoolJwtPayload, dto: TeacherReplyDto): Promise<import("@skoolos/types").MessageThreadDetail>;
}
//# sourceMappingURL=teacher-messages.controller.d.ts.map