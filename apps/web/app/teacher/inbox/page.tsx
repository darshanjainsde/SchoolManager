'use client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Notification { id: string; title: string; body?: string; kind: string; readAt?: string | null; createdAt: string }

export default function TeacherInboxPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const notifs = useQuery({ queryKey: ['t-notifs'], enabled: !!host, queryFn: () => api.get<Notification[]>('/notifications') });
  return (
    <div className="flex flex-col gap-6">
      <header><h1 className="text-2xl font-semibold text-slate-900">Inbox</h1></header>
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>{(notifs.data ?? []).filter((n) => !n.readAt).length} unread</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {!notifs.data?.length ? <div className="text-sm text-slate-500">Nothing yet.</div> : (
            notifs.data.map((n) => (
              <div key={n.id} className="rounded border border-slate-200 p-3 text-sm">
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
    </div>
  );
}
