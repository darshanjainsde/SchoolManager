import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import {
  assertNotificationKind,
  type NotificationListResult,
  type NotificationRow,
  type UnreadCountResult,
} from '@skoolos/types';
import { TenantContextService } from '../tenancy';

/**
 * Newest-first page size for the notification screen. The bell's unread COUNT
 * is always exact (a separate `count`), so this cap only bounds the list body,
 * never the badge number.
 */
const LIST_CAP = 50;

type NotificationRecord = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkType: string | null;
  linkId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

function toRow(n: NotificationRecord): NotificationRow {
  assertNotificationKind(n.kind);
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    linkType: n.linkType,
    linkId: n.linkId,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

/**
 * The in-app notification inbox behind the bell, for BOTH portals. Every query
 * is scoped to the caller's own `userId` (the JWT `sub`), so one user can never
 * read or mark another's notifications — the same self-scoping spine the
 * `/me/*` portal endpoints use.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly tenant: TenantContextService) {}

  /** Newest-first list + the exact unread total (GET /me/notifications).
   *  Cleared (dismissed) rows are invisible to every read path here. */
  async list(userId: string): Promise<NotificationListResult> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const [rows, unreadCount] = await Promise.all([
        tx.notification.findMany({
          where: { schoolId, userId, clearedAt: null },
          orderBy: { createdAt: 'desc' },
          take: LIST_CAP,
        }),
        tx.notification.count({ where: { schoolId, userId, readAt: null, clearedAt: null } }),
      ]);
      return { notifications: rows.map(toRow), unreadCount };
    });
  }

  /** Just the bell number (GET /me/notifications/unread-count). */
  async unreadCount(userId: string): Promise<UnreadCountResult> {
    const { schoolId } = this.tenant.requireTenant();
    const count = await withTenant(schoolId, (tx) =>
      tx.notification.count({ where: { schoolId, userId, readAt: null, clearedAt: null } }),
    );
    return { count };
  }

  /**
   * Marks the caller's unread notifications read and returns the REMAINING
   * unread total (so the client updates the bell without a second round-trip).
   * With `ids` → only those; without → mark all. Idempotent: the `readAt: null`
   * filter excludes already-read rows, so re-marking is a harmless no-op.
   */
  async markRead(userId: string, ids?: string[]): Promise<UnreadCountResult> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      await tx.notification.updateMany({
        where: { schoolId,
          userId,
          readAt: null,
          clearedAt: null,
          ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
        },
        data: { readAt: new Date() },
      });
      const count = await tx.notification.count({
        where: { schoolId, userId, readAt: null, clearedAt: null },
      });
      return { count };
    });
  }

  /**
   * Soft-clears ("dismisses") the caller's notifications and returns the
   * remaining unread total. With `ids` → only those (the per-row ✕); without →
   * clear everything (the footer's "Clear all"). Clearing implies reading: an
   * unread row that is dismissed must not keep inflating the badge, so
   * `readAt` is stamped alongside `clearedAt` where it was still null.
   * Idempotent via the `clearedAt: null` filter.
   */
  async clear(userId: string, ids?: string[]): Promise<UnreadCountResult> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const now = new Date();
      const scope = ids && ids.length > 0 ? { id: { in: ids } } : {};
      // Two updates, not one: readAt must only be stamped where it is null,
      // while clearedAt applies to every targeted row.
      await tx.notification.updateMany({
        where: { schoolId, userId, clearedAt: null, readAt: null, ...scope },
        data: { readAt: now },
      });
      await tx.notification.updateMany({
        where: { schoolId, userId, clearedAt: null, ...scope },
        data: { clearedAt: now },
      });
      const count = await tx.notification.count({
        where: { schoolId, userId, readAt: null, clearedAt: null },
      });
      return { count };
    });
  }
}
