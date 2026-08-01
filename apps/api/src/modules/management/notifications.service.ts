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

  /** Newest-first list + the exact unread total (GET /me/notifications). */
  async list(userId: string): Promise<NotificationListResult> {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const [rows, unreadCount] = await Promise.all([
        tx.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: LIST_CAP,
        }),
        tx.notification.count({ where: { userId, readAt: null } }),
      ]);
      return { notifications: rows.map(toRow), unreadCount };
    });
  }

  /** Just the bell number (GET /me/notifications/unread-count). */
  async unreadCount(userId: string): Promise<UnreadCountResult> {
    const { schoolId } = this.tenant.requireTenant();
    const count = await withTenant(schoolId, (tx) =>
      tx.notification.count({ where: { userId, readAt: null } }),
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
        where: {
          userId,
          readAt: null,
          ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
        },
        data: { readAt: new Date() },
      });
      const count = await tx.notification.count({ where: { userId, readAt: null } });
      return { count };
    });
  }
}
