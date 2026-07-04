'use client';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  firstName: string;
  lastName: string;
  admissionNo: string;
  rollNo: string | null;
  className: string | null;
  photoUrl: string | null;
}

interface TimetableSlot {
  id: string;
  dayOfWeek: number;
  period: { id: string; label: string; order: number; startTime?: string; endTime?: string };
  subject: { id: string; name: string; code: string };
  teacher: { id: string; firstName: string; lastName: string };
  classSection: { id: string; name: string };
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  classSectionId: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** JS getDay() → 1-7 (Mon=1, Sun=7) */
function todayDayOfWeek(): number {
  return new Date().getDay() || 7;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PortalDashboardPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const profileQuery = useQuery({
    queryKey: ['portal-profile'],
    queryFn: () => api.get<Profile>('/me/profile'),
    enabled: !!host,
    staleTime: 60_000,
  });

  const timetableQuery = useQuery({
    queryKey: ['portal-timetable'],
    queryFn: () => api.get<TimetableSlot[]>('/me/timetable'),
    enabled: !!host,
    staleTime: 60_000,
  });

  const announcementsQuery = useQuery({
    queryKey: ['portal-announcements'],
    queryFn: () => api.get<Announcement[]>('/me/announcements'),
    enabled: !!host,
    staleTime: 60_000,
  });

  const profile = profileQuery.data;
  const todaySlots = (timetableQuery.data ?? [])
    .filter((s) => s.dayOfWeek === todayDayOfWeek())
    .sort((a, b) => a.period.order - b.period.order);
  const latestAnnouncements = (announcementsQuery.data ?? []).slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting */}
      <header>
        <h1 className="text-2xl font-bold text-slate-900">
          {profile ? `Welcome back, ${profile.firstName}!` : 'Welcome back!'}
        </h1>
        {profile?.className && (
          <p className="mt-1 text-sm text-slate-500">Class: {profile.className}</p>
        )}
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Today's timetable */}
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s schedule</CardTitle>
          </CardHeader>
          <CardContent>
            {timetableQuery.isLoading && (
              <p className="text-sm text-slate-400">Loading…</p>
            )}
            {timetableQuery.error && (
              <p className="text-sm text-rose-500">
                {(timetableQuery.error as Error).message}
              </p>
            )}
            {!timetableQuery.isLoading && todaySlots.length === 0 && (
              <p className="text-sm text-slate-400">No classes scheduled for today.</p>
            )}
            {todaySlots.length > 0 && (
              <ul className="flex flex-col gap-2">
                {todaySlots.map((slot) => (
                  <li
                    key={slot.id}
                    className="flex items-start justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium text-slate-800">{slot.subject.name}</p>
                      <p className="text-xs text-slate-500">
                        {slot.teacher.firstName} {slot.teacher.lastName}
                      </p>
                    </div>
                    <span className="shrink-0 rounded bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                      {slot.period.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Latest announcements */}
        <Card>
          <CardHeader>
            <CardTitle>Latest announcements</CardTitle>
          </CardHeader>
          <CardContent>
            {announcementsQuery.isLoading && (
              <p className="text-sm text-slate-400">Loading…</p>
            )}
            {announcementsQuery.error && (
              <p className="text-sm text-rose-500">
                {(announcementsQuery.error as Error).message}
              </p>
            )}
            {!announcementsQuery.isLoading && latestAnnouncements.length === 0 && (
              <p className="text-sm text-slate-400">No announcements yet.</p>
            )}
            {latestAnnouncements.length > 0 && (
              <ul className="flex flex-col gap-3">
                {latestAnnouncements.map((ann) => (
                  <li key={ann.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-slate-800">{ann.title}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{formatDate(ann.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
