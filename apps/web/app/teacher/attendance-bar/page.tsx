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

/**
 * The benchmark is a slider, but a stepped one: it moves in fives between 50%
 * and 100%. A continuous slider would let a teacher land on "72%", and a
 * benchmark you cannot say out loud is a benchmark you cannot defend to a
 * parent. Fives keep every stop a number a school already uses.
 */
const BAR_MIN = 50;
const BAR_MAX = 100;
const BAR_STEP = 5;

/** Drawing height of the distribution's tallest bar, in px. */
const DIST_H = 54;
/** Floor so a 0%-attendance child is still a visible stub, not nothing. */
const DIST_FLOOR = 6;

/**
 * Percent → bar height. The scale starts at BAR_MIN rather than 0 because the
 * interesting range for attendance is 50–100%; a 0-based axis would squash
 * every real difference into the top third of the chart.
 */
function barHeight(percent: number): number {
  const t = Math.min(Math.max((percent - BAR_MIN) / (BAR_MAX - BAR_MIN), 0), 1);
  return Math.round(t * DIST_H) + DIST_FLOOR;
}

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
 *
 * The benchmark is DRAGGED, not chosen from a list of buttons, because the
 * question a teacher actually has is "is 75 the right place to draw it for
 * this class?" — and the only thing that answers it is watching the class
 * re-split under the line as it moves.
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

  /**
   * The distribution, lowest first. Sorting is what makes the chart readable:
   * an unsorted class is noise, a sorted one shows the tail the benchmark is
   * meant to catch. Children with no register taken are left out entirely —
   * a 0% that only means "never marked" would invent a tail that isn't there.
   */
  const distribution = useMemo(
    () => (data?.students ?? []).filter((s) => s.total > 0).sort((a, b) => a.percent - b.percent),
    [data],
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
              className="sk-btn sk-press"
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

          {/* The class, one bar per child, sorted lowest first. Bars below the
              benchmark go red, so dragging the slider repaints the tail live —
              that repaint is the entire argument for the control. Decorative:
              every number in it is also stated in the rows below, so screen
              readers are told nothing twice. */}
          {distribution.length > 0 && (
            <div className="sk-dist" data-testid="bar-dist" aria-hidden="true">
              <div className="sk-barline" style={{ bottom: barHeight(threshold) }} />
              {distribution.map((s) => (
                <span
                  key={s.studentId}
                  data-low={s.percent < threshold ? 'true' : undefined}
                  style={{ height: barHeight(s.percent) }}
                  title={`${s.name} · ${s.percent}%`}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-3">
            <input
              type="range"
              className="sk-bar"
              data-testid="bar-threshold"
              min={BAR_MIN}
              max={BAR_MAX}
              step={BAR_STEP}
              value={threshold}
              aria-label="Attendance benchmark"
              aria-valuetext={`${threshold} percent`}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
            <span
              className="text-[16px] font-bold"
              style={{ color: 'var(--sk-amber-ink)', minWidth: 48 }}
            >
              {threshold}%
            </span>
          </div>

          {data && (
            <div className="flex flex-wrap gap-2">
              <span className="sk-pill" data-tone="good">
                {distribution.length - below.length} above
              </span>
              <span className="sk-pill" data-tone="bad">
                {below.length} below
              </span>
            </div>
          )}
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
              className="sk-btn sk-press"
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
                  {/* The per-row mini-bar the histogram above now does better
                      is gone: two charts of the same numbers on one screen
                      made the benchmark line ambiguous. The row carries the
                      facts a name needs — days present, and when they last
                      heard from you. */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{s.name}</div>
                    <div className="meta">
                      {s.present} of {s.total} days
                      {cool ? ` · told ${daysSince(s.lastNoticeAt as string)}d ago` : ''}
                      {under && !cool && off ? ' · dropped from this round' : ''}
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
