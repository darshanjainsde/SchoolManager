'use client';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import type { NotificationListResult, NotificationRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { fetchNotifications, markNotificationsRead } from '@/lib/notifications-api';
import {
  FALLBACK_ICON,
  KIND_ICON,
  relativeTime,
  routeForNotification,
  type NotificationPortal,
} from './notification-meta';

const LIST_KEY = ['notifications-list'];
const COUNT_KEY = ['notifications-unread-count'];

function isUnread(n: NotificationRow): boolean {
  return n.readAt === null;
}

/**
 * The full inbox behind the bell, shared by `/teacher/notifications` and
 * `/portal/notifications`. Rows are grouped New (unread) then Earlier (read);
 * tapping a row optimistically marks it read and — if the kind has a
 * destination for this role — navigates there. "Mark all read" flips every row
 * at once. The unread-count query the bell polls is invalidated on every
 * mutation so the badge and this list never disagree.
 */
export function NotificationsView({ portal }: { portal: NotificationPortal }) {
  const router = useRouter();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const listQuery = useQuery({
    queryKey: LIST_KEY,
    enabled: !!host,
    queryFn: () => fetchNotifications(api),
  });

  const rows = listQuery.data?.notifications ?? [];
  const unread = rows.filter(isUnread);
  const earlier = rows.filter((n) => !isUnread(n));

  /** Optimistically stamp `readAt` on the given rows (or all) in the cache. */
  function optimisticallyMark(ids?: string[]) {
    const nowIso = new Date().toISOString();
    const targets = ids ? new Set(ids) : null;
    qc.setQueryData<NotificationListResult>(LIST_KEY, (prev) => {
      if (!prev) return prev;
      const next = prev.notifications.map((n) =>
        (targets === null || targets.has(n.id)) && n.readAt === null
          ? { ...n, readAt: nowIso }
          : n,
      );
      return { notifications: next, unreadCount: next.filter(isUnread).length };
    });
  }

  const markOne = useMutation({
    mutationFn: (id: string) => markNotificationsRead(api, [id]),
    onMutate: (id: string) => optimisticallyMark([id]),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: COUNT_KEY });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });

  const markAll = useMutation({
    mutationFn: () => markNotificationsRead(api),
    onMutate: () => optimisticallyMark(),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: COUNT_KEY });
      void qc.invalidateQueries({ queryKey: LIST_KEY });
    },
  });

  function onRowClick(n: NotificationRow) {
    if (isUnread(n)) markOne.mutate(n.id);
    const to = routeForNotification(n.kind, portal);
    if (to) router.push(to);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead flex items-start justify-between gap-3">
        <div>
          <h1>Notifications</h1>
          <p>Messages, results, announcements and more — newest first.</p>
        </div>
        {unread.length > 0 && (
          <button
            type="button"
            className="sk-btn"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
          >
            Mark all read
          </button>
        )}
      </header>

      {listQuery.isLoading && <p className="sk-state">Loading notifications…</p>}
      {listQuery.error && (
        <p className="sk-state err">{(listQuery.error as Error).message}</p>
      )}

      {!listQuery.isLoading && !listQuery.error && rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Bell className="h-10 w-10" style={{ color: 'var(--sk-ink-3)' }} aria-hidden="true" />
          <p className="sk-muted">You&rsquo;re all caught up — no notifications yet.</p>
        </div>
      )}

      {unread.length > 0 && (
        <section aria-labelledby="notif-new" className="flex flex-col gap-2">
          <h2 id="notif-new" className="sk-lab">New</h2>
          <ul className="flex flex-col gap-2">
            {unread.map((n) => (
              <NotificationItem key={n.id} n={n} onClick={() => onRowClick(n)} />
            ))}
          </ul>
        </section>
      )}

      {earlier.length > 0 && (
        <section aria-labelledby="notif-earlier" className="flex flex-col gap-2">
          <h2 id="notif-earlier" className="sk-lab">Earlier</h2>
          <ul className="flex flex-col gap-2">
            {earlier.map((n) => (
              <NotificationItem key={n.id} n={n} onClick={() => onRowClick(n)} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function NotificationItem({ n, onClick }: { n: NotificationRow; onClick: () => void }) {
  const Icon = KIND_ICON[n.kind] ?? FALLBACK_ICON;
  const unread = isUnread(n);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="sk-notif-row"
        data-unread={unread}
      >
        <span className="sk-notif-ic" aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <span className="sk-notif-body">
          <span className="sk-notif-title">
            {unread && <span className="sk-notif-dot" aria-hidden="true" />}
            {n.title}
          </span>
          {n.body && <span className="sk-notif-text">{n.body}</span>}
        </span>
        <time className="sk-notif-time" dateTime={n.createdAt}>
          {relativeTime(n.createdAt)}
        </time>
      </button>
    </li>
  );
}
