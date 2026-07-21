'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

interface ClassRow {
  id: string;
  name: string;
  grade: { name: string };
  classTeacher: { firstName: string; lastName: string } | null;
  _count: { students: number };
}

const AVATAR_COLORS = ['var(--sk-brand)', 'var(--sk-brand-2)', '#6b5ca8', '#a85c7b', '#4e7ca8', '#b0813b'];

function initials(grade: string, name: string): string {
  const g = (grade.match(/\d+/)?.[0] ?? grade.slice(0, 2)).toString();
  return `${g}${name.slice(0, 1).toUpperCase()}`;
}

export default function TeacherHomePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const classes = useQuery({
    queryKey: ['t-classes'],
    enabled: !!host,
    queryFn: () => api.get<ClassRow[]>('/manage/classes'),
  });

  const total = classes.data?.reduce((n, c) => n + c._count.students, 0) ?? 0;

  return (
    <>
      <header className="sk-pagehead">
        <h1>Your classes</h1>
        <p>Open a class to mark attendance — or use Tests and Results in the sidebar.</p>
      </header>

      {(classes.data?.length ?? 0) > 0 && (
        <div className="sk-kpis" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
          <div className="sk-kpi">
            <span className="lab">Classes</span>
            <span className="n">{classes.data!.length}</span>
          </div>
          <div className="sk-kpi">
            <span className="lab">Students</span>
            <span className="n">{total}</span>
          </div>
          <div className="sk-kpi">
            <span className="lab">Class teacher of</span>
            <span className="n">
              {classes.data!.filter((c) => c.classTeacher).length}
            </span>
          </div>
        </div>
      )}

      {classes.isLoading && <p className="sk-state">Loading classes…</p>}
      {classes.error && <p className="sk-state err">Couldn&apos;t load classes: {(classes.error as Error).message}</p>}
      {!classes.isLoading && !classes.error && !classes.data?.length && (
        <p className="sk-state">No classes have been set up yet — ask your school admin to add class sections.</p>
      )}

      {!!classes.data?.length && (
        <div className="sk-cardgrid">
          {classes.data.map((c, i) => (
            <Link
              key={c.id}
              href={`/teacher/attendance?classSectionId=${encodeURIComponent(c.id)}`}
              className="sk-entity"
            >
              <span className="av" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                {initials(c.grade.name, c.name)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nm">
                  {c.grade.name} · {c.name}
                </div>
                <div className="meta">
                  {c.classTeacher
                    ? `Class teacher · ${c.classTeacher.firstName} ${c.classTeacher.lastName}`
                    : 'No class teacher yet'}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span className="sk-pill" data-tone="info">
                    {c._count.students} {c._count.students === 1 ? 'student' : 'students'}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
