'use client';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CalendarX } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ────────────────────────────────────────────────────────────────────
// Mirrors StaffAttendanceService.mine's MyStaffAttendanceResult
// (apps/api/src/modules/management/staff-attendance.service.ts) — kept local
// rather than in @skoolos/types, matching how the admin staff-attendance
// page (apps/web/app/app/staff-attendance/page.tsx) already types this same
// shape locally rather than sharing it.

type Status = 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_LEAVE';

interface PersonDay {
  /** `YYYY-MM-DD` */
  date: string;
  status: Status;
}

interface PersonSummary {
  present: number;
  absent: number;
  late: number;
  onLeave: number;
  percent: number;
  days: PersonDay[];
}

interface MyStaffAttendance {
  person: { id: string; firstName: string; lastName: string; role: string };
  summary: PersonSummary;
}

const STATUS_LABEL: Record<Status, string> = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late',
  ON_LEAVE: 'On leave',
};

const STAFF_ROLE_LABEL: Record<string, string> = {
  OFFICE: 'Office staff',
  SUPPORT: 'Support staff',
  DRIVER: 'Driver',
  HELPER: 'Helper',
  SECURITY: 'Security',
  OTHER: 'Staff',
};

function monthLabel(): string {
  return new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function StaffHomePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });

  const { data, isLoading, error } = useQuery({
    queryKey: ['staff-attendance-mine'],
    queryFn: () => api.get<MyStaffAttendance>('/manage/staff-attendance/mine'),
    enabled: !!host,
    staleTime: 30_000,
  });

  const summary = data?.summary;
  const marked = summary ? summary.present + summary.absent + summary.late + summary.onLeave : 0;
  // Most recent first, capped so this stays a summary, not a full calendar.
  const recentDays = summary ? [...summary.days].reverse().slice(0, 10) : [];

  return (
    <div className="sk-anim" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <div className="sk-greet">
          {data ? (
            <>Hi, {data.person.firstName} 👋</>
          ) : (
            'Welcome back'
          )}
        </div>
        {data && <div className="sk-sub">{STAFF_ROLE_LABEL[data.person.role] ?? 'Staff'}</div>}
      </header>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Your attendance — {monthLabel()}</h3>
        </div>
        <div className="sk-card-b">
          {isLoading && <p className="sk-state">Loading your attendance…</p>}
          {error && <p className="sk-state err">{(error as Error).message}</p>}
          {!isLoading && !error && summary && marked === 0 && (
            <p className="sk-state">No attendance has been recorded for you yet this month.</p>
          )}
          {!isLoading && !error && summary && marked > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="sk-kpis">
                <div className="sk-kpi">
                  <span className="lab">
                    <CalendarCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    This month
                  </span>
                  <span className="n">{summary.percent}%</span>
                  <span className="hint">
                    {summary.present} of {summary.present + summary.absent + summary.late} days present
                  </span>
                </div>
                <div className="sk-kpi">
                  <span className="lab">Present</span>
                  <span className="n">{summary.present}</span>
                </div>
                <div className="sk-kpi">
                  <span className="lab">Absent</span>
                  <span className="n">{summary.absent}</span>
                </div>
                <div className="sk-kpi">
                  <span className="lab">Late</span>
                  <span className="n">{summary.late}</span>
                </div>
              </div>

              <div>
                {recentDays.map((day) => (
                  <div className="sk-row" key={day.date}>
                    <span
                      className="badge"
                      style={{ background: 'var(--sk-brand-2)', width: 34, height: 34, fontSize: 11 }}
                    >
                      {STATUS_LABEL[day.status].slice(0, 1)}
                    </span>
                    <div>
                      <div className="nm">{formatDate(day.date)}</div>
                      <div className="meta">{STATUS_LABEL[day.status]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Honest placeholder: LeaveApplication is scoped to Teacher rows only
          today (see LeaveService) — a Staff-row leave path is real schema
          work (nullable teacherId + staffId pair, plus every consumer of
          the approve/cancel coverage-generation logic), not something to
          half-build alongside an attendance view. Said plainly rather than
          hidden, so staff know what's coming instead of wondering where it
          went. */}
      <div className="sk-card">
        <div className="sk-card-h">
          <h3>Leave</h3>
        </div>
        <div className="sk-card-b">
          <p className="sk-state" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarX className="h-4 w-4 shrink-0" aria-hidden="true" />
            Applying for leave isn&rsquo;t available here yet — ask your school admin in the meantime. It&rsquo;s planned for a future update.
          </p>
        </div>
      </div>
    </div>
  );
}
