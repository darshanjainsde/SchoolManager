'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { TimetableEditor, type SchoolClass } from '@/components/timetable/TimetableEditor';

/**
 * The Timetable page is the editor (components/timetable/TimetableEditor)
 * over this year's classes. The Sessions tab mounts the same editor over the
 * next year's classes to adjust the copied timetable before Start.
 */
export default function TimetablePage() {
  return (
    <Suspense fallback={<p className="sk-state">Loading…</p>}>
      <TimetableInner />
    </Suspense>
  );
}

function TimetableInner() {
  const host = useHost();
  const params = useSearchParams();
  const api = useApi({ audience: 'school', hostHeader: host });
  // Deep links (e.g. "Open class timetable" on a leave coverage gap) pass the
  // class to land on as ?classSectionId=…
  const [classSectionId, setClassSectionId] = useState(params.get('classSectionId') ?? '');
  const classesQuery = useQuery({
    queryKey: ['mng-classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  return (
    <>
      <header className="sk-pagehead">
        <h1>Timetable builder</h1>
        <p>Assign teacher + subject to each period. Clashes are flagged automatically.</p>
      </header>
      <TimetableEditor
        classes={classesQuery.data ?? []}
        classesLoading={classesQuery.isLoading}
        classSectionId={classSectionId}
        onClassSectionChange={setClassSectionId}
      />
    </>
  );
}
