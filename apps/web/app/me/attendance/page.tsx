'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface Me { userId: string; role: string }
interface AttendanceRow {
  id: string; date: string; status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
}

export default function MyAttendancePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [me, setMe] = useState<Me | undefined>();

  useEffect(() => {
    if (!host) return;
    api.get<Me>('/auth/me').then(setMe).catch(() => undefined);
  }, [host, api]);

  const list = useQuery({
    queryKey: ['my-attendance', me?.userId],
    enabled: !!me,
    queryFn: () => api.get<AttendanceRow[]>(`/attendance?studentUserId=${me!.userId}`),
  });

  const pct = useMemo(() => {
    const rows = list.data ?? [];
    if (rows.length === 0) return null;
    const present = rows.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
    return Math.round((present / rows.length) * 100);
  }, [list.data]);

  if (me?.role && me.role !== 'STUDENT') {
    return (
      <div className="text-sm text-slate-500">
        Parents — pick a student first (linked-students switcher lands in the next iteration).
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">My attendance</h1>
        <p className="text-sm text-slate-500">All days marked across the term.</p>
      </header>
      {pct !== null && (
        <Card>
          <CardHeader>
            <CardDescription>Attendance rate</CardDescription>
            <CardTitle className="text-3xl">{pct}%</CardTitle>
          </CardHeader>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>{list.data?.length ?? 0} entries</CardDescription>
        </CardHeader>
        <CardContent>
          {!list.data?.length ? <div className="text-sm text-slate-500">No records yet.</div> : (
            <Table>
              <THead><Tr><Th>Date</Th><Th>Status</Th></Tr></THead>
              <TBody>
                {list.data.map((r) => (
                  <Tr key={r.id}>
                    <Td>{new Date(r.date).toLocaleDateString()}</Td>
                    <Td>
                      <Badge tone={r.status === 'PRESENT' ? 'success' : r.status === 'ABSENT' ? 'danger' : r.status === 'LATE' ? 'warning' : 'neutral'}>
                        {r.status}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
