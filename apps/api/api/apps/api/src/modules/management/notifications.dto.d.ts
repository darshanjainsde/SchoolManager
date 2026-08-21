/**
 * Body for `POST /me/notifications/read`. Omit `ids` to mark EVERY unread
 * notification read (the "Mark all read" action); pass a specific set to mark
 * just those (e.g. the one the user tapped through). Only the caller's own rows
 * are ever touched — the service scopes by `userId`, never by these ids alone.
 */
export declare class MarkNotificationsReadDto {
    ids?: string[];
}
/**
 * Body for `POST /me/notifications/clear` — same shape and same scoping rule
 * as marking read: omit `ids` for "Clear all", pass a set for the per-row ✕.
 */
export declare class ClearNotificationsDto {
    ids?: string[];
}
//# sourceMappingURL=notifications.dto.d.ts.map