import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { NotificationsService } from './notifications.service';
import { ClearNotificationsDto, MarkNotificationsReadDto } from './notifications.dto';
/**
 * The notification bell, for EVERY logged-in school user — student, teacher, or
 * admin (one screen, one endpoint set; only the rows differ per user). Unlike
 * the role-specific `/me/messages` (STUDENT) and `/manage/messages` (TEACHER)
 * surfaces, notifications are role-agnostic, so this controller admits all
 * in-app roles and scopes strictly by the caller's own `sub`.
 */
export declare class NotificationsController {
    private readonly notifications;
    constructor(notifications: NotificationsService);
    unreadCount(u: SchoolJwtPayload): Promise<import("@skoolos/types").UnreadCountResult>;
    list(u: SchoolJwtPayload): Promise<import("@skoolos/types").NotificationListResult>;
    markRead(u: SchoolJwtPayload, dto: MarkNotificationsReadDto): Promise<import("@skoolos/types").UnreadCountResult>;
    /** Soft clear — the notification screen's per-row ✕ (with ids) and its
     *  "Clear all" (without). Returns the remaining unread total, like `read`. */
    clear(u: SchoolJwtPayload, dto: ClearNotificationsDto): Promise<import("@skoolos/types").UnreadCountResult>;
}
//# sourceMappingURL=notifications.controller.d.ts.map