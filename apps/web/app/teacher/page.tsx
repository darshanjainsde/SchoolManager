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
  academicYear: { name: string };
  sections: Array<{ id: string; name: string }>;
}

export default function TeacherHomePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const classes = useQuery({ queryKey: ['t-classes'], enabled: !!host, queryFn: () => api.get<ClassRow[]>('/classes') });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Welcome</h1>
        <p className="text-sm text-slate-500">Classes you teach. Click in to mark attendance or post an assignment.</p>
      </header>
      {!classes.data?.length ? (
        <div className="text-sm text-slate-500">No classes yet — your admin hasn&apos;t assigned you.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {classes.data.map((c) => (
            <Link key={c.id} href={`/teacher/attendance?classId=${c.id}`} className="block">
              <Card>
                <CardHeader>
                  <CardDescription>{c.academicYear.name}</CardDescription>
                  <CardTitle>{c.grade.name} · {c.name}</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-500">
                  {c.sections.length} sections
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
