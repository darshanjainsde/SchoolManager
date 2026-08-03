'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AttendanceRateRow,
  AttendanceRatesResult,
  NotifyLowAttendanceResult,
} from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

/**
 * Who in THIS class is falling behind, and one action to tell their families.
 *
 * Lives inside the Attendance page rather than on a nav item of its own: it is
 * a view OF the register, not a separate feature. A teacher arrives having
 * just marked the class, and the question "who is slipping?" is the natural
 * next one — so it belongs under the roster they are already looking at, for
 * the class and term they have already chosen.
 *
 * NO CHART. An earlier version drew a per-student histogram with the
 * benchmark as a dashed rule across it. On a real class it actively misled:
 * the scale ran 50–100%, so a class sitting at 83–100% bunched into a row of
 * near-identical bars with the line cutting through their lower third —
 * twenty children comfortably above the benchmark looked like they were on
 * it. The two counts below say the same thing and cannot be misread.
 *
 * The benchmark is DRAGGED because the teacher's real question is "is 75 the
 * right line for this class?", and the only thing that answers it is watching
 * the class re-split as it moves. It steps in fives: a benchmark of "72%" is
 * not one anybody can defend to a parent.
 */

/**
 * The track runs the FULL 0-100, not the 50-100 the useful range occupies.
 *
 * A bar labelled "75%" has to look three-quarters full. Starting the track at
 * 50 put 75 at the exact midpoint, so the control contradicted its own number
 * — and a benchmark you cannot read off the bar is worse than no bar. The
 * compressed range bought a little more precision in the half that matters and
 * paid for it by lying about where the value sits.
 */
const BAR_MIN = 0;
const BAR_MAX = 100;
const BAR_STEP = 5;

/** Matches the server's `NOTICE_COOLDOWN_DAYS`. */
const COOLDOWN_DAYS = 7;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function WhoNeedsAWord({
  classSectionId,
  className,
}: {
  classSectionId: string;
  className: string;
}): React.JSX.Element | null {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [threshold, setThreshold] = useState(75);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const ratesKey = ['t-bar-rates', classSectionId];
  const ratesQuery = useQuery({
    queryKey: ratesKey,
    enabled: !!host && !!classSectionId,
    queryFn: () =>
      api.get<AttendanceRatesResult>(
        `/manage/attendance/rates?classSectionId=${encodeURIComponent(classSectionId)}`,
      ),
  });
  const data = ratesQuery.data;

  const below = useMemo(
    () => (data?.students ?? []).filter((s) => s.percent < threshold && s.total > 0),
    [data, threshold],
  );
  const marked = useMemo(
    () => (data?.students ?? []).filter((s) => s.total > 0),
    [data],
  );

  const inCooldown = (s: AttendanceRateRow) =>
    s.lastNoticeAt !== null && daysSince(s.lastNoticeAt) < COOLDOWN_DAYS;
  const willNotify = below.filter((s) => !excluded.has(s.studentId) && !inCooldown(s));
  const cooling = below.filter(inCooldown);

  const notify = useMutation({
    mutationFn: () =>
      api.post<NotifyLowAttendanceResult>('/manage/attendance/notify-low', {
        classSectionId,
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

  if (!classSectionId) return null;

  return (
    <div className="sk-card" data-testid="who-needs-a-word">
      <div className="sk-card-h">
        <h3>Who needs a word</h3>
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
        {ratesQuery.isLoading && <p className="sk-state">Reading the register…</p>}
        {ratesQuery.error && <p className="sk-state err">{(ratesQuery.error as Error).message}</p>}

        {data && (
          <>
            <div className="flex items-center gap-3" data-testid="bar-benchmark">
              <label htmlFor="bar-threshold" className="sk-lab" style={{ margin: 0 }}>
                Below
              </label>
              <input
                id="bar-threshold"
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
                style={{ flex: 1, maxWidth: 320 }}
              />
              <output
                htmlFor="bar-threshold"
                className="nm"
                style={{ fontVariantNumeric: 'tabular-nums', minWidth: 44 }}
              >
                {threshold}%
              </output>
            </div>

            <p className="sk-state" style={{ padding: '6px 0 0' }}>
              {below.length === 0
                ? `Everyone in ${className} is above ${threshold}%, over ${data.daysMarked} marked days.`
                : `${below.length} of ${marked.length} in ${className} below ${threshold}%, over ${data.daysMarked} marked days.` +
                  ' Each family hears only about their own child — never a list.'}
            </p>

            {below.map((s) => {
              const cool = inCooldown(s);
              const off = excluded.has(s.studentId) || cool;
              return (
                <button
                  key={s.studentId}
                  type="button"
                  className="sk-row sk-press"
                  data-testid={`bar-row-${s.studentId}`}
                  disabled={cool}
                  onClick={() => toggle(s.studentId)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 0,
                    cursor: cool ? 'default' : 'pointer',
                    opacity: off ? 0.55 : 1,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">{s.name}</div>
                    <div className="meta">
                      {s.present} of {s.total} days
                      {cool ? ` · told ${daysSince(s.lastNoticeAt as string)}d ago` : ''}
                    </div>
                  </div>
                  <span className="sp" />
                  <span className="sk-pill" data-tone="bad">
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
          </>
        )}
      </div>
    </div>
  );
}
