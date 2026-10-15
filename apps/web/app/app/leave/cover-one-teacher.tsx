'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Note, Overlay } from '@/components/ui/kit';

/**
 * COVER A LEAVE WITH ONE TEACHER.
 *
 * Picking a teacher for each of a leave's periods one at a time is thirty
 * dropdowns for a five-day leave. After the first pick the desk is asked
 * once — "give Rahul the rest?" — and a drawer lists every open period of
 * that leave with Rahul's standing in each: free ones ticked, the clashes
 * named and left open. The server re-checks every tick on save, so the
 * drawer can be stale without ever being wrong.
 */

export type CoverPreviewState = 'FREE' | 'THEIRS' | 'TAKEN' | 'TEACHING' | 'COVERING' | 'ON_LEAVE';
export interface CoverPreviewRow {
  gapId: string;
  date: string;
  periodLabel: string;
  time: string;
  className: string;
  state: CoverPreviewState;
  reason: string | null;
}
export interface CoverPreview {
  leave: { id: string; teacherName: string; dates: string };
  teacher: { id: string; name: string };
  busyDayAt: number;
  days: { date: string; label: string; coversBefore: number }[];
  rows: CoverPreviewRow[];
}
export interface CoverFit {
  open: number;
  teachers: { id: string; name: string; free: number }[];
}
interface CoverBatchResult {
  given: number;
  alreadyTheirs: number;
  skipped: { gapId: string; when: string; className: string; why: string; reason: string }[];
  stillOpen: number;
}

const CLASH: ReadonlySet<CoverPreviewState> = new Set(['TEACHING', 'COVERING', 'ON_LEAVE']);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const previewKey = (leaveId: string, teacherId: string) => ['a-cover-preview', leaveId, teacherId] as const;
export const fitKey = (leaveId: string) => ['a-cover-fit', leaveId] as const;

function useSchoolApi() {
  const host = useHost();
  return { host, api: useApi({ audience: 'school', hostHeader: host }) };
}

/**
 * "Give Rahul the rest of Priya's leave?" — shown right under the row just
 * picked, never at the top of a long list. Says nothing at all until it knows
 * there IS something to give: no flash of a question that then vanishes.
 */
export function CoverOffer({ leaveId, teacherId, onOpen, onDismiss }: { leaveId: string; teacherId: string; onOpen: () => void; onDismiss: () => void }) {
  const { host, api } = useSchoolApi();
  const preview = useQuery({
    queryKey: previewKey(leaveId, teacherId),
    enabled: !!host,
    queryFn: () => api.get<CoverPreview>(`/manage/leave/${leaveId}/cover-preview?teacherId=${teacherId}`),
  });
  const p = preview.data;
  if (!p) return null;
  const free = p.rows.filter((r) => r.state === 'FREE').length;
  if (free === 0) return null;
  const clash = p.rows.filter((r) => CLASH.has(r.state)).length;
  const open = p.rows.filter((r) => r.state !== 'THEIRS' && r.state !== 'TAKEN').length;
  return (
    <div className="sk-coveroffer" role="status" data-testid="cover-offer">
      <div className="sk-coveroffer-t">
        <b>Give {p.teacher.name} the rest of {p.leave.teacherName}&apos;s leave?</b>
        <span>
          {p.teacher.name} is free for {free} of the {plural(open, 'open period')}.
          {clash > 0 ? ` ${clash} ${clash === 1 ? 'clashes' : 'clash'} with their own day and ${clash === 1 ? 'stays' : 'stay'} open.` : ''}
        </span>
      </div>
      <div className="sk-coveroffer-b">
        <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={onOpen}>
          See the {plural(open, 'period')}
        </button>
        <button type="button" className="sk-btn sk-press" onClick={onDismiss}>
          No thanks
        </button>
      </div>
    </div>
  );
}

/** Pick the teacher first (from the header's "Cover with one teacher"): best fit at the top. */
function TeacherChoice({ leaveId, onChoose }: { leaveId: string; onChoose: (id: string) => void }) {
  const { host, api } = useSchoolApi();
  const fit = useQuery({ queryKey: fitKey(leaveId), enabled: !!host, queryFn: () => api.get<CoverFit>(`/manage/leave/${leaveId}/cover-fit`) });
  if (fit.isPending) return <p className="sk-state">Finding who is free…</p>;
  if (fit.isError) return <p className="sk-state err">{(fit.error as Error).message}</p>;
  if (fit.data.open === 0) return <p className="sk-state">Every period of this leave already has a teacher.</p>;
  if (fit.data.teachers.length === 0) return <p className="sk-state">Nobody is free for any of the {plural(fit.data.open, 'open period')}. Each one needs someone different.</p>;
  return (
    <div className="sk-cvd-choose" role="list" aria-label="Teachers, most free first">
      <p className="sk-muted">Who should take it? Most free first.</p>
      {fit.data.teachers.map((t) => (
        <button key={t.id} type="button" role="listitem" className="sk-cvd-pick sk-press" onClick={() => onChoose(t.id)}>
          <span className="n">{t.name}</span>
          <span className="c">
            free for {t.free} of {fit.data.open}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The drawer. Every open period of the leave, by day, with this teacher's
 * standing in each. Free ones start ticked; a clash cannot be ticked and says
 * why; a day can be ticked whole. Already-covered periods are folded at the
 * bottom and never touched.
 */
export function CoverOneTeacherDrawer({ leaveId, teacherId: initialTeacher, onClose, onDone }: {
  leaveId: string;
  teacherId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { host, api } = useSchoolApi();
  const [teacherId, setTeacherId] = useState<string | null>(initialTeacher);
  const preview = useQuery({
    queryKey: previewKey(leaveId, teacherId ?? ''),
    enabled: !!host && !!teacherId,
    queryFn: () => api.get<CoverPreview>(`/manage/leave/${leaveId}/cover-preview?teacherId=${teacherId}`),
  });
  const p = preview.data;
  // Unticked ids, so "everything free starts ticked" needs no effect to seed it.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<CoverBatchResult | null>(null);

  const free = useMemo(() => (p ? p.rows.filter((r) => r.state === 'FREE') : []), [p]);
  const ticked = free.filter((r) => !unticked.has(r.gapId));
  const byDay = useMemo(() => {
    const m = new Map<string, CoverPreviewRow[]>();
    for (const r of p?.rows ?? []) if (r.state !== 'TAKEN') m.set(r.date, [...(m.get(r.date) ?? []), r]);
    return m;
  }, [p]);
  const taken = p ? p.rows.filter((r) => r.state === 'TAKEN') : [];

  const save = useMutation({
    mutationFn: () => api.post<CoverBatchResult>(`/manage/leave/${leaveId}/cover-batch`, { substituteTeacherId: teacherId, substitutionIds: ticked.map((r) => r.gapId) }),
    onSuccess: (r) => {
      setResult(r);
      onDone();
    },
  });

  const toggle = (ids: string[], on: boolean) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.delete(id);
        else next.add(id);
      }
      return next;
    });

  const name = p?.teacher.name ?? 'this teacher';
  const title = p ? `Cover ${p.leave.teacherName}'s leave with ${p.teacher.name}` : 'Cover with one teacher';
  const stayOpen = p ? p.rows.filter((r) => r.state !== 'THEIRS' && r.state !== 'TAKEN').length - ticked.length : 0;

  const footer = result ? (
    <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={onClose}>
      Done
    </button>
  ) : p ? (
    <div className="sk-cvd-foot">
      <span className="sk-muted">{stayOpen > 0 ? `${plural(stayOpen, 'period')} ${stayOpen === 1 ? 'stays' : 'stay'} open — pick someone else for ${stayOpen === 1 ? 'it' : 'those'}.` : 'Nothing left open.'}</span>
      <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={ticked.length === 0 || save.isPending} onClick={() => save.mutate()} data-testid="cover-batch-save">
        {save.isPending ? 'Giving…' : `Give ${name} ${plural(ticked.length, 'period')}`}
      </button>
    </div>
  ) : null;

  return (
    <Overlay title={title} subtitle={p ? p.leave.dates : undefined} onClose={onClose} footer={footer}>
      {!teacherId ? (
        <TeacherChoice leaveId={leaveId} onChoose={setTeacherId} />
      ) : result ? (
        <div className="sk-cvd-result" data-testid="cover-batch-result">
          <p>
            <b>
              {name} now covers {plural((p?.rows.filter((r) => r.state === 'THEIRS').length ?? 0) + result.given, 'period')} of this leave.
            </b>{' '}
            They have been told{result.given > 1 ? ' in one message' : ''}.
          </p>
          {result.skipped.length > 0 ? (
            <Note>
              <b>{plural(result.skipped.length, 'period was', 'periods were')} not given, because the picture changed after this opened:</b>
              <ul className="sk-cvd-skips">
                {result.skipped.map((k) => (
                  <li key={k.gapId}>
                    {k.when ? `${k.when}, ${k.className}: ` : ''}
                    {k.reason}
                  </li>
                ))}
              </ul>
            </Note>
          ) : null}
          <p className="sk-muted">{result.stillOpen > 0 ? `${plural(result.stillOpen, 'period')} of this leave still need${result.stillOpen === 1 ? 's' : ''} a teacher. Pick someone for one, and the rest will be offered again.` : 'Every period of this leave now has a teacher.'}</p>
        </div>
      ) : preview.isPending ? (
        <p className="sk-state">Checking {name}&apos;s day for each period…</p>
      ) : preview.isError ? (
        <p className="sk-state err">{(preview.error as Error).message}</p>
      ) : p ? (
        <div className="sk-cvd">
          {!initialTeacher ? (
            <button type="button" className="sk-cvd-change" onClick={() => { setTeacherId(null); setUnticked(new Set()); }}>
              Change teacher
            </button>
          ) : null}
          <p className="sk-cvd-load" aria-label={`${name}'s covers each day`}>
            {p.days.map((d) => {
              const add = ticked.filter((r) => r.date === d.date).length;
              const after = d.coversBefore + add;
              return (
                <span key={d.date} data-busy={after >= p.busyDayAt ? 'true' : undefined}>
                  {d.label}: <b>{add > 0 ? `${d.coversBefore} → ${after}` : d.coversBefore}</b>
                </span>
              );
            })}
          </p>
          {[...byDay].map(([date, rows]) => {
            const day = p.days.find((d) => d.date === date);
            const dayFree = rows.filter((r) => r.state === 'FREE');
            const dayTicked = dayFree.filter((r) => !unticked.has(r.gapId)).length;
            const after = (day?.coversBefore ?? 0) + dayTicked;
            return (
              <section key={date} className="sk-cvd-day" aria-label={day?.label ?? date}>
                <div className="sk-cvd-dayh">
                  <label>
                    <input
                      type="checkbox"
                      disabled={dayFree.length === 0}
                      checked={dayFree.length > 0 && dayTicked === dayFree.length}
                      ref={(el) => {
                        if (el) el.indeterminate = dayTicked > 0 && dayTicked < dayFree.length;
                      }}
                      onChange={(e) => toggle(dayFree.map((r) => r.gapId), e.target.checked)}
                      aria-label={`All free periods on ${day?.label ?? date}`}
                    />
                    <span>{day?.label ?? date}</span>
                  </label>
                  <span className="c">{dayFree.length} of {rows.length} free</span>
                </div>
                {after >= p.busyDayAt && dayTicked > 0 ? (
                  <p className="sk-cvd-warn" data-testid={`busy-${date}`}>{name} would have {after} covers that day.</p>
                ) : null}
                {rows.map((r) => {
                  const isFree = r.state === 'FREE';
                  const theirs = r.state === 'THEIRS';
                  const id = `cvd-${r.gapId}`;
                  return (
                    <div key={r.gapId} className="sk-cvd-row" data-state={r.state} data-testid={`cvd-${r.gapId}`}>
                      <input
                        id={id}
                        type="checkbox"
                        disabled={!isFree}
                        checked={theirs || (isFree && !unticked.has(r.gapId))}
                        onChange={(e) => toggle([r.gapId], e.target.checked)}
                      />
                      <label htmlFor={id}>
                        <span className="t">
                          {r.className} · {r.periodLabel}
                          {r.time ? <span className="m"> · {r.time}</span> : null}
                        </span>
                        {r.reason ? <span className="r">{r.reason}</span> : null}
                      </label>
                      <span className="sk-pill" data-tone={isFree ? 'good' : theirs ? undefined : 'warn'}>
                        {isFree ? 'Free' : theirs ? 'Already theirs' : 'Busy'}
                      </span>
                    </div>
                  );
                })}
              </section>
            );
          })}
          {taken.length > 0 ? (
            <details className="sk-cvd-taken">
              <summary>{plural(taken.length, 'period')} already covered by someone else — left as they are</summary>
              <ul>
                {taken.map((r) => (
                  <li key={r.gapId}>
                    {r.className} · {r.periodLabel}, {p.days.find((d) => d.date === r.date)?.label ?? r.date}: {r.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {save.isError ? <p className="sk-state err">{(save.error as Error).message}</p> : null}
        </div>
      ) : null}
    </Overlay>
  );
}
