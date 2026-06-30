'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/use-api';

export default function AppDashboardPage() {
  const [host, setHost] = useState<string | undefined>();
  useEffect(() => setHost(window.location.host), []);
  const api = useApi({ audience: 'school', hostHeader: host });

  const users = useQuery({
    queryKey: ['users'],
    enabled: !!host,
    queryFn: () => api.get<Array<{ role: string }>>('/users'),
  });
  const grades = useQuery({
    queryKey: ['grades'],
    enabled: !!host,
    queryFn: () => api.get<Array<{ id: string }>>('/grades'),
  });
  const classes = useQuery({
    queryKey: ['classes'],
    enabled: !!host,
    queryFn: () => api.get<Array<{ id: string }>>('/classes'),
  });

  const countByRole = (role: string) => (users.data ?? []).filter((u) => u.role === role).length;

  const cards = [
    { label: 'Students', value: countByRole('STUDENT') },
    { label: 'Teachers', value: countByRole('TEACHER') },
    { label: 'Parents', value: countByRole('PARENT') },
    { label: 'Staff', value: countByRole('STAFF') },
    { label: 'Grades', value: grades.data?.length ?? 0 },
    { label: 'Classes', value: classes.data?.length ?? 0 },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Welcome back</h1>
        <p className="text-sm text-slate-500">School snapshot. Refreshes on every visit.</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader>
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="text-3xl">{c.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
