'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { fetchUnreadCount } from '@/lib/notifications-api';
import type { NotificationPortal } from './notification-meta';

const HREF: Record<NotificationPortal, string> = {
  teacher: '/teacher/notifications',
  student: '/portal/notifications',
};

/**
 * The topbar bell. Polls only the cheap unread-count endpoint (not the whole
 * list) every 30s and on window focus, so the badge stays fresh without paying
 * for the full inbox on every portal page. Clicking is a plain navigation to
 * the portal's notifications route — the count query key is shared with the
 * full view so the badge clears the moment the list marks things read.
 */
export function NotificationBell({ portal }: { portal: NotificationPortal }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const unread = useQuery({
    queryKey: ['notifications-unread-count'],
    enabled: !!host,
    queryFn: () => fetchUnreadCount(api),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const count = unread.data?.count ?? 0;
  const label = count > 9 ? '9+' : String(count);

  return (
    <Link
      href={HREF[portal]}
      className="sk-bell"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      {count > 0 && (
        <span className="sk-bell-badge" aria-hidden="true">
          {label}
        </span>
      )}
    </Link>
  );
}
