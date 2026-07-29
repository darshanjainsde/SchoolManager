'use client';
import { useQuery } from '@tanstack/react-query';
import type { Holiday } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { HolidayList } from '@/components/teacher/HolidayList';

export default function TeacherHolidaysPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  // Role-agnostic: `/me/holidays` is the same upcoming-list query
  // `/manage/holidays` (admin CRUD) reads with, shared across every
  // authenticated school role — see PortalService.holidays.
  const query = useQuery({
    queryKey: ['t-holidays'],
    enabled: !!host,
    queryFn: () => api.get<Holiday[]>('/me/holidays'),
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Holidays</h1>
        <p>Upcoming school holidays, set by your school admin.</p>
      </header>

      <div className="sk-card">
        <div className="sk-card-b">
          {query.isLoading && <p className="sk-state">Loading holidays…</p>}
          {query.error && <p className="sk-state err">{(query.error as Error).message}</p>}
          {query.data && <HolidayList holidays={query.data} />}
        </div>
      </div>
    </div>
  );
}
