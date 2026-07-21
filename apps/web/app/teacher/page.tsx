'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface ClassRow {
  id: string;
  name: string;
  grade: { name: string };
  classTeacher: { firstName: string; lastName: string } | null;
  _count: { students: number };
}

export default function TeacherHomePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const classes = useQuery({
    queryKey: ['t-classes'],
    enabled: !!host,
    queryFn: () => api.get<ClassRow[]>('/manage/classes'),
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Welcome</h1>
        <p className="text-sm text-slate-500">
          Your school&apos;s classes. Open one to mark attendance, or use Tests and Results in the sidebar.
        </p>
      </header>

      {classes.isLoading && <div className="text-sm text-slate-400">Loading classes…</div>}

      {classes.error && (
        <div className="text-sm text-rose-600">
          Couldn&apos;t load classes: {(classes.error as Error).message}
        </div>
      )}

      {!classes.isLoading && !classes.error && !classes.data?.length && (
        <div className="text-sm text-slate-500">
          No classes have been set up yet — ask your school admin to add class sections.
        </div>
      )}

      {!!classes.data?.length && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.data.map((c) => (
            <Link
              key={c.id}
              href={`/teacher/attendance?classSectionId=${encodeURIComponent(c.id)}`}
              className="block"
            >
              <Card>
                <CardHeader>
                  <CardDescription>
                    {c.classTeacher
                      ? `Class teacher · ${c.classTeacher.firstName} ${c.classTeacher.lastName}`
                      : 'No class teacher assigned'}
                  </CardDescription>
                  <CardTitle>
                    {c.grade.name} · {c.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-500">
                  {c._count.students} {c._count.students === 1 ? 'student' : 'students'}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
