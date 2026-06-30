'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Notification {
  id: string; title: string; body?: string; kind: string; readAt?: string | null; createdAt: string;
}

export default function MeHomePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const notifs = useQuery({
    queryKey: ['me-notifs'],
    enabled: !!host,
    queryFn: () => api.get<Notification[]>('/notifications'),
  });
  const announcements = useQuery({
    queryKey: ['me-announcements'],
    enabled: !!host,
    queryFn: () => api.get<Array<{ id: string; title: string; body: string; createdAt: string }>>('/announcements'),
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Hello</h1>
        <p className="text-sm text-slate-500">Your latest notifications and school announcements.</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>{(notifs.data ?? []).filter((n) => !n.readAt).length} unread</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!notifs.data?.length ? <div className="text-sm text-slate-500">Nothing yet.</div> : (
              notifs.data.slice(0, 10).map((n) => (
                <div key={n.id} className="rounded border border-slate-200 p-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{n.title}</span>
                    {!n.readAt && <Badge tone="warning">unread</Badge>}
                  </div>
                  {n.body && <div className="text-slate-600">{n.body}</div>}
                  <div className="text-xs text-slate-400">{new Date(n.createdAt).toLocaleString()}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Announcements</CardTitle>
            <CardDescription>{announcements.data?.length ?? 0} visible to you</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!announcements.data?.length ? <div className="text-sm text-slate-500">No announcements yet.</div> : (
              announcements.data.slice(0, 10).map((a) => (
                <div key={a.id} className="rounded border border-slate-200 p-2 text-sm">
                  <div className="font-medium">{a.title}</div>
                  <div className="text-slate-600">{a.body}</div>
                  <div className="text-xs text-slate-400">{new Date(a.createdAt).toLocaleString()}</div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-2 text-sm text-slate-500">
        Quick links:{' '}
        <Link href="/me/attendance" className="underline">Attendance</Link>
        <Link href="/me/assignments" className="underline">Assignments</Link>
        <Link href="/me/results" className="underline">Results</Link>
        <Link href="/me/invoices" className="underline">Invoices</Link>
      </div>
    </div>
  );
}
