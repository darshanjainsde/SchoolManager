'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, GraduationCap, ClipboardList, Percent } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

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

const ATTENDANCE_TONES: Record<AttendanceStatus, 'good' | 'warn' | 'bad'> = {
  PRESENT: 'good',
  ABSENT: 'bad',
  LATE: 'warn',
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

/** A compact KPI tile, optionally linking through to the full page. */
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
  tone?: 'good' | 'warn' | 'bad';
  href?: string;
}) {
  const inner = (
    <>
      <span className="lab">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {label}
      </span>
      <span className="n">{value}</span>
      {hint && <span className="hint">{hint}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="sk-kpi" data-tone={tone}>
      {inner}
    </Link>
  ) : (
    <div className="sk-kpi" data-tone={tone}>
      {inner}
    </div>
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
    <div className="sk-anim" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <div className="sk-greet">
          {profile ? (
            <>
              Hi, {profile.firstName} <span className="wave">👋</span>
            </>
          ) : (
            'Welcome back'
          )}
        </div>
        {profile?.className && <div className="sk-sub">{profile.className} · Roll {profile.rollNo ?? '—'}</div>}
      </header>

      {/* Upcoming-test reminder — the thing a student should never miss */}
      {nextExam && (
        <div className="sk-remind">
          <span className="ic">🔔</span>
          <div style={{ flex: 1 }}>
            <b>
              {nextExam.subjectName} · {nextExam.title} — {daysUntilLabel(nextExam.scheduledAt).toLowerCase()}
            </b>
            <p>
              {formatDate(nextExam.scheduledAt)}
              {nextExam.syllabus ? ` · ${nextExam.syllabus}` : ''} · out of {nextExam.maxMarks}
            </p>
          </div>
        </div>
      )}

      {/* At-a-glance KPIs */}
      <div className="sk-kpis">
        <StatTile
          icon={CalendarCheck}
          label="Today"
          href="/portal/attendance"
          tone={todayStatus ? ATTENDANCE_TONES[todayStatus] : undefined}
          value={tileText(attendanceQuery, todayStatus ? ATTENDANCE_LABELS[todayStatus] : undefined, 'Not marked')}
          hint="Attendance"
        />
        <StatTile
          icon={Percent}
          label="This month"
          href="/portal/attendance"
          tone={attendance && attendanceMarked > 0 && attendance.percent < 75 ? 'warn' : undefined}
          value={tileText(attendanceQuery, attendanceMarked > 0 ? `${attendance?.percent}%` : undefined, 'No records')}
          hint={attendanceMarked > 0 ? `${attendance?.present} of ${attendanceMarked} days present` : 'Nothing recorded yet'}
        />
        <StatTile
          icon={ClipboardList}
          label="Next test"
          value={tileText(examsQuery, nextExam?.subjectName, 'None scheduled')}
          hint={nextExam ? `${nextExam.title} — ${daysUntilLabel(nextExam.scheduledAt).toLowerCase()}` : 'No upcoming tests'}
        />
        <StatTile
          icon={GraduationCap}
          label="Latest result"
          href="/portal/results"
          tone={
            latestResult
              ? latestResult.marks < latestResult.classAverage
                ? 'bad'
                : 'good'
              : undefined
          }
          value={tileText(
            resultsQuery,
            latestResult ? `${latestResult.marks}/${latestResult.maxMarks}` : undefined,
            'None yet',
          )}
          hint={latestResult ? `${latestResult.subjectName} · class avg ${latestResult.classAverage}` : 'None published yet'}
        />
      </div>

      <div className="sk-grid2">
        {/* Today's timetable */}
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Today&apos;s schedule</h3>
          </div>
          <div className="sk-card-b">
            {timetableQuery.isLoading && <p className="sk-state">Loading…</p>}
            {timetableQuery.error && <p className="sk-state err">{(timetableQuery.error as Error).message}</p>}
            {!timetableQuery.isLoading && !timetableQuery.error && todaySlots.length === 0 && (
              <p className="sk-state">No classes scheduled for today.</p>
            )}
            {todaySlots.length > 0 && (
              <div>
                {todaySlots.map((slot) => (
                  <div className="sk-row" key={slot.id}>
                    <span
                      className="badge"
                      style={{ background: 'var(--sk-brand-2)', width: 34, height: 34, fontSize: 11 }}
                    >
                      {slot.period.label}
                    </span>
                    <div>
                      <div className="nm">{slot.subject.name}</div>
                      <div className="meta">
                        {slot.teacher.firstName} {slot.teacher.lastName}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Latest announcements */}
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Latest announcements</h3>
          </div>
          <div className="sk-card-b">
            {announcementsQuery.isLoading && <p className="sk-state">Loading…</p>}
            {announcementsQuery.error && <p className="sk-state err">{(announcementsQuery.error as Error).message}</p>}
            {!announcementsQuery.isLoading && !announcementsQuery.error && latestAnnouncements.length === 0 && (
              <p className="sk-state">No announcements yet.</p>
            )}
            {latestAnnouncements.length > 0 && (
              <div>
                {latestAnnouncements.map((ann) => (
                  <div className="sk-row" key={ann.id} style={{ alignItems: 'flex-start' }}>
                    <span className="badge" style={{ background: 'var(--sk-amber)', color: '#2a1c04', width: 34, height: 34 }}>
                      📣
                    </span>
                    <div>
                      <div className="nm">{ann.title}</div>
                      <div className="meta">{formatDate(ann.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
