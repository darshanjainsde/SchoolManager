'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AttendanceRateRow,
  AttendanceRatesResult,
  MyClassSection,
  NotifyLowAttendanceResult,
} from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

/** Round benchmarks only — a teacher should never have to defend "72%". */
const STEPS = [50, 60, 65, 70, 75, 80, 85, 90] as const;

/** Matches the server's `NOTICE_COOLDOWN_DAYS`. */
const COOLDOWN_DAYS = 7;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * The attendance bar on the web (Phase 5·3): who is falling behind, and one
 * action to tell their families privately.
 *
 * Desktop gets what the phone cannot show — the whole class as one bar chart,
 * so "below 75%" is a line you can see rather than a filter you have to trust.
 * Everything below it is pre-selected and individually droppable; families
 * inside the cooldown are greyed with the reason spelled out.
 */
export default function AttendanceBarPage(): React.JSX.Element {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [classId, setClassId] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(75);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const classesQuery = useQuery({
    queryKey: ['t-bar-classes'],
    enabled: !!host,
    queryFn: () => api.get<MyClassSection[]>('/manage/attendance/my-classes'),
  });
  const classes = classesQuery.data ?? [];
  const activeId = classId ?? classes[0]?.classSectionId ?? null;

  const ratesKey = ['t-bar-rates', activeId];
  const ratesQuery = useQuery({
    queryKey: ratesKey,
    enabled: !!host && !!activeId,
    queryFn: () =>
      api.get<AttendanceRatesResult>(
        `/manage/attendance/rates?classSectionId=${encodeURIComponent(activeId as string)}`,
      ),
  });
  const data = ratesQuery.data;

  const below = useMemo(
    () => (data?.students ?? []).filter((s) => s.percent < threshold && s.total > 0),
    [data, threshold],
  );
  const inCooldown = (s: AttendanceRateRow) =>
    s.lastNoticeAt !== null && daysSince(s.lastNoticeAt) < COOLDOWN_DAYS;
  const willNotify = below.filter((s) => !excluded.has(s.studentId) && !inCooldown(s));
  const cooling = below.filter(inCooldown);

  const notify = useMutation({
    mutationFn: () =>
      api.post<NotifyLowAttendanceResult>('/manage/attendance/notify-low', {
        classSectionId: activeId,
        threshold,
        from: data?.from,
        to: data?.to,
        studentIds: willNotify.map((s) => s.studentId),
      }),
    onSuccess: (res) => {
      toast.success(
        res.notified === 0
          ? 'Nobody new to tell right now.'
          : `${res.notified} ${res.notified === 1 ? 'family' : 'families'} told privately.` +
              (res.skippedInCooldown ? ` ${res.skippedInCooldown} skipped — told this week.` : ''),
      );
      setExcluded(new Set());
      void qc.invalidateQueries({ queryKey: ratesKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead">
        <h1>Who needs a word</h1>
        <p>
          Attendance across the term, lowest first. Each family hears only about their own child —
          never a list.
        </p>
      </header>

      {classes.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {classes.map((c) => (
            <button
              key={c.classSectionId}
              type="button"
              className="sk-btn"
              data-testid={`bar-class-${c.classSectionId}`}
              data-variant={c.classSectionId === activeId ? 'primary' : undefined}
              onClick={() => {
                setClassId(c.classSectionId);
                setExcluded(new Set());
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="sk-card" data-testid="bar-benchmark">
        <div className="sk-card-h">
          <h3>Below {threshold}%</h3>
        </div>
        <div className="sk-card-b flex flex-col gap-3">
          <p className="sk-state" style={{ padding: 0 }}>
            {data
              ? `${below.length} of ${data.students.length} in ${data.className}, over ${data.daysMarked} marked days.`
              : 'Reading the register…'}
          </p>
          <div className="flex flex-wrap gap-2">
            {STEPS.map((step) => (
              <button
                key={step}
                type="button"
                className="sk-btn"
                data-testid={`bar-step-${step}`}
                data-variant={step === threshold ? 'primary' : undefined}
                onClick={() => setThreshold(step)}
              >
                {step}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {ratesQuery.isLoading && <p className="sk-state">Reading the register…</p>}
      {ratesQuery.error && <p className="sk-state err">{(ratesQuery.error as Error).message}</p>}

      {data && (
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>{data.className}</h3>
            <span className="sp" />
            <button
              type="button"
              className="sk-btn"
              data-variant="primary"
              data-testid="bar-notify"
              disabled={willNotify.length === 0 || notify.isPending}
              onClick={() => notify.mutate()}
            >
              {notify.isPending
                ? 'Sending…'
                : willNotify.length === 0
                  ? 'Nobody to tell'
                  : `Tell ${willNotify.length} ${willNotify.length === 1 ? 'family' : 'families'}`}
            </button>
          </div>
          <div className="sk-card-b">
            {data.students.map((s) => {
              const under = s.percent < threshold && s.total > 0;
              const cool = inCooldown(s);
              const off = excluded.has(s.studentId) || cool;
              return (
                <button
                  key={s.studentId}
                  type="button"
                  className="sk-row"
                  data-testid={`bar-row-${s.studentId}`}
                  disabled={!under || cool}
                  onClick={() => toggle(s.studentId)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 0,
                    cursor: under && !cool ? 'pointer' : 'default',
                    opacity: under && off ? 0.55 : 1,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{s.name}</div>
                    <div className="meta">
                      {s.present} of {s.total} days
                      {cool ? ` · told ${daysSince(s.lastNoticeAt as string)}d ago` : ''}
                    </div>
                    {/* The bar itself: the class read at a glance, with the
                        benchmark as a line rather than a number to trust. */}
                    <div
                      aria-hidden="true"
                      style={{
                        position: 'relative',
                        height: 6,
                        borderRadius: 3,
                        background: 'var(--sk-bg-2)',
                        marginTop: 6,
                        maxWidth: 340,
                      }}
                    >
                      <div
                        style={{
                          width: `${s.percent}%`,
                          height: '100%',
                          borderRadius: 3,
                          background: under ? 'var(--sk-bad)' : 'var(--sk-good)',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: -2,
                          bottom: -2,
                          left: `${threshold}%`,
                          width: 2,
                          background: 'var(--sk-ink-3)',
                        }}
                      />
                    </div>
                  </div>
                  <span className="sp" />
                  <span className="sk-pill" data-tone={under ? 'bad' : 'good'}>
                    {s.percent}%
                  </span>
                </button>
              );
            })}
            {cooling.length > 0 && (
              <p className="sk-state" data-testid="bar-cooling">
                {cooling.length} already heard from you this week.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
