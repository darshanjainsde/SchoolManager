'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, EmptyRow, Pill, type HallPayload } from './ui';

type Status = 'PRESENT' | 'ABSENT' | 'LATE';
const NEXT_STATUS: Record<Status, Status> = { PRESENT: 'ABSENT', ABSENT: 'LATE', LATE: 'PRESENT' };

/**
 * The reading hall. The class teacher has usually already taken the register
 * for this period, so the default is to CONFIRM that rather than retake it —
 * two registers for one period is how the counts drifted apart before.
 *
 * Ported unchanged from the standalone portal apart from losing its own <h1>:
 * the shell owns the pagehead now. Its markup already resolves every colour
 * through a --sk-* token, so it was never off-theme — it was just in the wrong
 * shell.
 */
export default function HallTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [pickedSection, setPickedSection] = useState<string | null>(null);
  const [retaking, setRetaking] = useState(false);
  const [edits, setEdits] = useState<Record<string, Status>>({});

  const hall = useQuery({
    queryKey: ['library-hall', host, pickedSection],
    enabled: !!host,
    queryFn: () =>
      api.get<HallPayload>(`/library/hall${pickedSection ? `?classSectionId=${pickedSection}` : ''}`),
  });

  const save = useMutation({
    mutationFn: (body: { classSectionId: string; periodId?: string; source: 'SYNCED' | 'RETAKEN'; marks: { studentId: string; status: Status }[] }) =>
      api.post('/library/hall/visits', body),
    onSuccess: (_d, vars) => {
      setRetaking(false);
      setEdits({});
      qc.invalidateQueries({ queryKey: ['library-hall'] });
      toast.success(
        vars.source === 'SYNCED'
          ? 'Confirmed the class teacher’s register for the library period'
          : 'Library attendance saved',
      );
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (hall.isLoading || !hall.data) {
    return <p className="sk-state">Checking the hall…</p>;
  }
  const d = hall.data;
  const statusOf = (studentId: string, fallback: Status): Status => edits[studentId] ?? fallback;
  const marks = d.roster.map((r) => ({ studentId: r.studentId, status: statusOf(r.studentId, r.status) }));
  const present = marks.filter((m) => m.status === 'PRESENT').length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-end gap-2">
        <span className="text-xs text-[var(--sk-ink-3)]">
          {d.period ? `${d.period.label} · ${d.period.startTime}–${d.period.endTime}` : 'No class period right now'}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-[240px,1fr]">
        <div className="flex flex-col gap-3">
          <div className="rounded-xl bg-gradient-to-br from-[var(--sk-hero-1)] to-[var(--sk-hero-2)] p-4 text-white shadow">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-85">In the hall now</div>
            <div className="mt-1 font-serif text-2xl font-semibold" style={{ fontFamily: 'var(--sk-serif)' }}>
              {d.hall.nowClasses.length ? d.hall.nowClasses.map((c) => c.className).join(' + ') : 'No class'}
            </div>
            <div className="mt-3 rounded-lg bg-white/15 px-3 py-2 text-xs">
              Hall in use: <b className="tabular-nums">{d.hall.inUse} of {d.hall.capacityClasses}</b> classes
              <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-white/25">
                <i
                  className="block h-full rounded bg-[#F5B23C] transition-all"
                  style={{ width: `${Math.min(100, (d.hall.inUse / Math.max(1, d.hall.capacityClasses)) * 100)}%` }}
                />
              </div>
            </div>
          </div>

          <label className="text-xs text-[var(--sk-ink-2)]">
            <span className="mb-1 block font-bold uppercase tracking-wide text-[var(--sk-ink-3)]">Class</span>
            <select
              value={d.section?.id ?? ''}
              onChange={(e) => { setPickedSection(e.target.value || null); setRetaking(false); setEdits({}); }}
              className="w-full rounded-lg border border-[var(--sk-line)] bg-[var(--sk-card)] px-2.5 py-2 text-sm text-[var(--sk-ink)]"
            >
              <option value="">{d.hall.nowClasses.length ? 'From the timetable' : 'Pick a class…'}</option>
              {d.sections.map((s) => (
                <option key={s.id} value={s.id}>{s.className}</option>
              ))}
            </select>
          </label>
        </div>

        <Card className="overflow-hidden">
          {!d.section ? (
            <div className="px-4 py-5 text-center">
              <EmptyRow>
                No library period on the timetable right now — pick a class on the left to take its register.
              </EmptyRow>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--sk-line)] bg-[var(--sk-brand-tint)] px-3 py-2 text-xs text-[var(--sk-brand-2)]">
                {retaking ? (
                  <>
                    <b>Retaking for the library.</b> Tap a student to flip Present → Absent → Late.
                    <span className="ml-auto flex gap-1.5">
                      <button
                        className="sk-btn"
                        data-size="sm"
                        data-variant="primary"
                        type="button"
                        onClick={() => save.mutate({ classSectionId: d.section!.id, periodId: d.period?.id, source: 'RETAKEN', marks })}
                        disabled={save.isPending}
                      >
                        Save register
                      </button>
                      <button
                        className="sk-btn"
                        data-size="sm"
                        type="button"
                        onClick={() => { setRetaking(false); setEdits({}); }}
                      >
                        Back to synced
                      </button>
                    </span>
                  </>
                ) : d.teacherRegister.taken ? (
                  <>
                    <span>
                      <b>{d.teacherRegister.takenBy} took attendance
                      {d.teacherRegister.takenAt
                        ? ` at ${new Date(d.teacherRegister.takenAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
                        : ''}.</b>{' '}
                      Using that register — confirm it for the library, or retake.
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      <button
                        className="sk-btn"
                        data-size="sm"
                        data-variant="primary"
                        type="button"
                        onClick={() => save.mutate({ classSectionId: d.section!.id, periodId: d.period?.id, source: 'SYNCED', marks })}
                        disabled={save.isPending}
                      >
                        Confirm
                      </button>
                      <button className="sk-btn" data-size="sm" type="button" onClick={() => setRetaking(true)}>
                        Retake
                      </button>
                    </span>
                  </>
                ) : (
                  <>
                    <b>No register yet today.</b> Take the library&rsquo;s own.
                    <span className="ml-auto">
                      <button
                        className="sk-btn"
                        data-size="sm"
                        data-variant="primary"
                        type="button"
                        onClick={() => setRetaking(true)}
                      >
                        Take attendance
                      </button>
                    </span>
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-4">
                {d.roster.map((r) => {
                  const st = statusOf(r.studentId, r.status);
                  return (
                    <button
                      key={r.studentId}
                      disabled={!retaking}
                      onClick={() => setEdits((e) => ({ ...e, [r.studentId]: NEXT_STATUS[st] }))}
                      className={`rounded-lg border px-2.5 py-1.5 text-left text-xs disabled:cursor-default ${
                        st === 'ABSENT'
                          ? 'border-[var(--sk-bad)]'
                          : st === 'LATE'
                            ? 'border-[var(--sk-amber)]'
                            : 'border-[var(--sk-line)]'
                      } bg-[var(--sk-card)]`}
                    >
                      <span className="block truncate font-bold text-[var(--sk-ink)]">{r.name}</span>
                      <span className="mt-0.5 flex items-center justify-between">
                        <span className="font-mono text-[10px] text-[var(--sk-ink-3)]">{r.rollNo ?? '—'}</span>
                        <span
                          className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-extrabold ${
                            st === 'PRESENT'
                              ? 'bg-[var(--sk-good-tint)] text-[var(--sk-good)]'
                              : st === 'ABSENT'
                                ? 'bg-[var(--sk-bad-tint)] text-[var(--sk-bad)]'
                                : 'bg-[var(--sk-amber-tint)] text-[var(--sk-amber-ink)]'
                          }`}
                        >
                          {st[0]}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--sk-line)] px-3 py-2 text-xs text-[var(--sk-ink-3)]">
                <Pill tone="good">{present} present</Pill>
                <Pill tone="bad">{d.roster.length - present} absent/late</Pill>
                {d.savedVisit ? (
                  <Pill tone="brand">
                    saved ({d.savedVisit.source === 'SYNCED' ? 'from the teacher’s register' : 'retaken'})
                  </Pill>
                ) : null}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
