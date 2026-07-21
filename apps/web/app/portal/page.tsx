'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, GraduationCap, ClipboardList, Percent } from 'lucide-react';
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

type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE';

interface AttendanceSummary {
  month: string;
  percent: number;
  present: number;
  absent: number;
  late: number;
  days: { date: string; status: AttendanceStatus }[];
}

interface UpcomingExam {
  id: string;
  title: string;
  subjectName: string;
  scheduledAt: string;
  maxMarks: number;
  syllabus: string | null;
}

interface PublishedResult {
  examId: string;
  title: string;
  subjectName: string;
  scheduledAt: string;
  marks: number;
  maxMarks: number;
  classAverage: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
};

const ATTENDANCE_TONES: Record<AttendanceStatus, string> = {
  PRESENT: 'text-emerald-700',
  ABSENT: 'text-rose-700',
  LATE: 'text-amber-700',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** JS getDay() → 1-7 (Mon=1, Sun=7) */
function todayDayOfWeek(): number {
  return new Date().getDay() || 7;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** `YYYY-MM` for the given local date — the key `/me/attendance` expects. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` for the given local date. */
function dayKey(d: Date): string {
  return `${monthKey(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Whole days from today until `iso`, counted on calendar-day boundaries so a
 * test at 09:00 tomorrow reads "in 1 day", not "in 0 days".
 */
function daysUntil(iso: string): number {
  const target = new Date(iso);
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86_400_000);
}

function daysUntilLabel(iso: string): string {
  const d = daysUntil(iso);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `In ${d} days`;
}

/** A compact stat tile, optionally linking through to the full page. */
function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  href,
}: {
  icon: typeof CalendarCheck;
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  href?: string;
}) {
  const body = (
    <Card className={href ? 'h-full transition-colors hover:border-teal-300' : 'h-full'}>
      <CardContent className="flex h-full flex-col gap-1 p-4">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {label}
        </div>
        <p className={`text-lg font-bold ${tone ?? 'text-slate-900'}`}>{value}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
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

  const thisMonth = monthKey(new Date());

  const attendanceQuery = useQuery({
    queryKey: ['portal-attendance', thisMonth],
    queryFn: () => api.get<AttendanceSummary>(`/me/attendance?month=${thisMonth}`),
    enabled: !!host,
    staleTime: 60_000,
  });

  const examsQuery = useQuery({
    queryKey: ['portal-exams'],
    queryFn: () => api.get<UpcomingExam[]>('/me/exams'),
    enabled: !!host,
    staleTime: 60_000,
  });

  const resultsQuery = useQuery({
    queryKey: ['portal-results'],
    queryFn: () => api.get<PublishedResult[]>('/me/results'),
    enabled: !!host,
    staleTime: 60_000,
  });

  const profile = profileQuery.data;
  const todaySlots = (timetableQuery.data ?? [])
    .filter((s) => s.dayOfWeek === todayDayOfWeek())
    .sort((a, b) => a.period.order - b.period.order);
  const latestAnnouncements = (announcementsQuery.data ?? []).slice(0, 3);

  // `/me/attendance` returns only the days that were actually marked, so a
  // missing entry means "not marked yet today" — not "absent".
  const attendance = attendanceQuery.data;
  const todayStatus = attendance?.days.find((d) => d.date === dayKey(new Date()))?.status;
  const attendanceMarked = attendance
    ? attendance.present + attendance.absent + attendance.late
    : 0;

  // Both lists arrive pre-ordered by the API: exams ascending (soonest first),
  // results descending (most recent first).
  const nextExam = examsQuery.data?.[0];
  const latestResult = resultsQuery.data?.[0];

  /** Loading/error/empty all collapse to one short string per tile. */
  const tileText = (
    query: { isLoading: boolean; error: unknown },
    value: string | undefined,
    empty: string,
  ): string => {
    if (query.isLoading) return '…';
    if (query.error) return 'Unavailable';
    return value ?? empty;
  };

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

      {/* At-a-glance: attendance, next test, latest result */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={CalendarCheck}
          label="Today"
          href="/portal/attendance"
          tone={todayStatus ? ATTENDANCE_TONES[todayStatus] : undefined}
          value={tileText(
            attendanceQuery,
            todayStatus ? ATTENDANCE_LABELS[todayStatus] : undefined,
            'Not marked',
          )}
          hint="Attendance"
        />
        <StatTile
          icon={Percent}
          label="This month"
          href="/portal/attendance"
          value={tileText(
            attendanceQuery,
            attendanceMarked > 0 ? `${attendance?.percent}%` : undefined,
            'No records',
          )}
          hint={
            attendanceMarked > 0
              ? `${attendance?.present} of ${attendanceMarked} days present`
              : 'No attendance recorded yet'
          }
        />
        <StatTile
          icon={ClipboardList}
          label="Next test"
          value={tileText(examsQuery, nextExam?.subjectName, 'None scheduled')}
          hint={
            nextExam
              ? `${nextExam.title} — ${daysUntilLabel(nextExam.scheduledAt)}`
              : 'No upcoming tests'
          }
        />
        <StatTile
          icon={GraduationCap}
          label="Latest result"
          href="/portal/results"
          value={tileText(
            resultsQuery,
            latestResult ? `${latestResult.marks}/${latestResult.maxMarks}` : undefined,
            'None yet',
          )}
          hint={
            latestResult
              ? `${latestResult.subjectName} — class avg ${latestResult.classAverage}`
              : 'No results published yet'
          }
        />
      </div>

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
