import { type NotificationListResult, type UnreadCountResult } from '@skoolos/types';
import { TenantContextService } from '../tenancy';
/**
 * The in-app notification inbox behind the bell, for BOTH portals. Every query
 * is scoped to the caller's own `userId` (the JWT `sub`), so one user can never
 * read or mark another's notifications — the same self-scoping spine the
 * `/me/*` portal endpoints use.
 */
export declare class NotificationsService {
    private readonly tenant;
    constructor(tenant: TenantContextService);
    /** Newest-first list + the exact unread total (GET /me/notifications).
     *  Cleared (dismissed) rows are invisible to every read path here. */
    list(userId: string): Promise<NotificationListResult>;
    /** Just the bell number (GET /me/notifications/unread-count). */
    unreadCount(userId: string): Promise<UnreadCountResult>;
    /**
     * Marks the caller's unread notifications read and returns the REMAINING
     * unread total (so the client updates the bell without a second round-trip).
     * With `ids` → only those; without → mark all. Idempotent: the `readAt: null`
     * filter excludes already-read rows, so re-marking is a harmless no-op.
     */
    markRead(userId: string, ids?: string[]): Promise<UnreadCountResult>;
    /**
     * Soft-clears ("dismisses") the caller's notifications and returns the
     * remaining unread total. With `ids` → only those (the per-row ✕); without →
     * clear everything (the footer's "Clear all"). Clearing implies reading: an
     * unread row that is dismissed must not keep inflating the badge, so
     * `readAt` is stamped alongside `clearedAt` where it was still null.
     * Idempotent via the `clearedAt: null` filter.
     */
    clear(userId: string, ids?: string[]): Promise<UnreadCountResult>;
}
//# sourceMappingURL=notifications.service.d.ts.map