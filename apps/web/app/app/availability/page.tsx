'use client';
import { useState, useMemo, type CSSProperties, type FocusEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AvailabilityTeacher {
  id: string;
  firstName: string;
  lastName: string;
}

interface AvailabilityPeriod {
  id: string;
  order: number;
  label: string;
}

interface BusyEntry {
  teacherId: string;
  dayOfWeek: number;
  periodId: string;
}

interface AvailabilityResponse {
  teachers: AvailabilityTeacher[];
  periods: AvailabilityPeriod[];
  busy: BusyEntry[];
}

const DAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
];

const AVATAR_COLORS = ['var(--sk-brand)', 'var(--sk-brand-2)', '#6b5ca8', '#a85c7b', '#4e7ca8', '#b0813b'];

function teacherInitials(t: AvailabilityTeacher): string {
  return `${t.firstName.charAt(0)}${t.lastName.charAt(0)}`.toUpperCase();
}

// Themed select: no dedicated CSS class, styled inline, with a brand-colored
// focus ring applied directly to the DOM node on focus/blur.
const fieldStyle: CSSProperties = {
  display: 'block',
  border: '1px solid var(--sk-line-2)',
  borderRadius: 10,
  padding: '9px 11px',
  background: 'var(--sk-card)',
  color: 'var(--sk-ink)',
  fontSize: 13.5,
  fontFamily: 'inherit',
  transition: 'border-color 0.12s, box-shadow 0.12s',
};

function ringFocus(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-brand)';
  e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--sk-brand) 18%, transparent)';
}

function ringBlur(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-line-2)';
  e.currentTarget.style.boxShadow = 'none';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AvailabilityPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [day, setDay] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['availability'],
    queryFn: () => api.get<AvailabilityResponse>('/manage/availability'),
    enabled: !!host,
  });

  // O(1) busy lookup: `${teacherId}-${dayOfWeek}-${periodId}`
  const busySet = useMemo(() => {
    const s = new Set<string>();
    for (const b of data?.busy ?? []) s.add(`${b.teacherId}-${b.dayOfWeek}-${b.periodId}`);
    return s;
  }, [data]);

  const teachers = data?.teachers ?? [];
  const periods = [...(data?.periods ?? [])].sort((a, b) => a.order - b.order);
  const dayLabel = DAYS.find((d) => d.value === day)?.label ?? '';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Page header */}
      <header className="sk-pagehead" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Teacher availability</h1>
          <p>Who is free and who is teaching, per period.</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label htmlFor="day" className="sk-lab">
            Day
          </label>
          <select
            id="day"
            className="sk-press"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
          >
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>{dayLabel}</h3>
        </div>
        {/* Keyed on the day so switching days REPLACES this panel rather than
            mutating it — which is what makes `sk-wfade` (the pitch's
            `.wview.on`) fire. Without the key React would reuse the node, the
            rows would swap silently, and a mis-tapped day would look
            identical to a day with the same shape of timetable. */}
        <div className="sk-card-b sk-wfade" key={day}>
          {isLoading && <p className="sk-state">Loading…</p>}
          {!!error && <p className="sk-state err">{(error as Error).message}</p>}

          {!isLoading && !error && teachers.length === 0 && (
            <p className="sk-state">No teachers yet — add teachers first.</p>
          )}
          {!isLoading && !error && teachers.length > 0 && periods.length === 0 && (
            <p className="sk-state">No periods defined yet.</p>
          )}

          {!isLoading && !error && teachers.length > 0 && periods.length > 0 && (
            <>
              {teachers.map((t, i) => {
                const busyCount = periods.filter((p) => busySet.has(`${t.id}-${day}-${p.id}`)).length;
                const allFree = busyCount === 0;
                const allBusy = busyCount === periods.length;
                return (
                  <div key={t.id} className="sk-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 10 }}>
                    <span className="badge" style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                      {teacherInitials(t)}
                    </span>
                    <div style={{ minWidth: 160 }}>
                      <div className="nm">
                        {t.firstName} {t.lastName}
                      </div>
                      <div className="meta">
                        {busyCount}/{periods.length} periods teaching
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flex: '1 1 260px' }}>
                      {periods.map((p) => {
                        const busy = busySet.has(`${t.id}-${day}-${p.id}`);
                        return (
                          <span
                            key={p.id}
                            className="sk-pill"
                            data-tone={busy ? 'bad' : 'good'}
                            title={`${p.label}: ${busy ? 'Teaching' : 'Free'}`}
                          >
                            {p.label}
                          </span>
                        );
                      })}
                    </div>

                    <span className="sp" />
                    {/* THE STAMP, and only here: "free all day" / "fully
                        booked" is a VERDICT on the row above it, the one thing
                        on this page a head of department is actually hunting
                        for. The per-period pills stay still — stamping twenty
                        of them would make the verdict impossible to find. */}
                    <span
                      className="sk-pill sk-stampin sk-in"
                      data-tone={allFree ? 'good' : allBusy ? 'bad' : 'warn'}
                      style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                    >
                      {allFree ? 'Free all day' : allBusy ? 'Fully booked' : 'Partially free'}
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </>
  );
}
