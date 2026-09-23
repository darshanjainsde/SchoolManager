'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { Card, CardBody, CardHead, EmptyRow, Note, RulesAsAt, rupees, toMinor } from './ui';
import type { Grade, SalarySettings, SuggestedGrade } from './types';

/**
 * The split bar's colours: one brand hue stepped down, because the parts of a
 * gross are one thing divided rather than four unrelated categories. Basic
 * takes the strongest step, which is also the one a reader is checking.
 */
const SPLIT_SHADES = ['var(--sk-brand)', '#8b83f0', '#bdb8f7', '#ded9fb', '#eef0ff'];

const todayISO = () => new Date().toISOString().slice(0, 10);
/** The 1st of next month — when a change to pay would normally start. */
function nextMonthISO(): string {
  const d = new Date();
  return `${d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()}-${String((d.getUTCMonth() + 2 - 1) % 12 + 1).padStart(2, '0')}-01`;
}

function BandBar({ min, max, at }: { min: number; max: number; at?: number }) {
  if (max <= 0) return null;
  // Drawn against a span 25% wider than the band on each side, so a band is
  // never the full width of its own bar and "inside" is visibly inside.
  const span = max - min;
  const lo = min - span * 0.25;
  const hi = max + span * 0.25;
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  return (
    <div className="sk-payband" role="presentation">
      <i style={{ left: pos(min), right: `${100 - parseFloat(pos(max))}%` }} />
      {at != null ? <b style={{ left: pos(at) }} /> : null}
    </div>
  );
}

function SplitBar({ split }: { split: { key: string; name: string; amountMinor: number }[] }) {
  const total = split.reduce((a, l) => a + l.amountMinor, 0);
  if (total <= 0) return null;
  return (
    <>
      <div className="sk-paysplit" role="presentation">
        {split.map((l, i) => (
          <span key={l.key} style={{ width: `${(l.amountMinor / total) * 100}%`, background: SPLIT_SHADES[i % SPLIT_SHADES.length] }} />
        ))}
      </div>
      <span className="sk-paysplitkey">
        {split.filter((l) => l.amountMinor > 0).map((l) => `${l.name} ${Math.round((l.amountMinor / total) * 100)}`).join(' · ')}
      </span>
    </>
  );
}

interface Draft {
  id?: string; name: string; description: string;
  bandMin: string; bandMax: string;
  basicPct: string;
}

const BLANK: Draft = { name: '', description: '', bandMin: '', bandMax: '', basicPct: '' };

function draftOf(g: Grade): Draft {
  return {
    id: g.id, name: g.name, description: g.description ?? '',
    bandMin: g.bandMinMinor ? String(Math.round(g.bandMinMinor / 100)) : '',
    bandMax: g.bandMaxMinor ? String(Math.round(g.bandMaxMinor / 100)) : '',
    basicPct: g.overrides.basic?.rateBps != null ? String(g.overrides.basic.rateBps / 100) : '',
  };
}

/**
 * GRADES — a job's pay.
 *
 * The idea the whole module now rests on: a school does not set forty-eight
 * salaries, it sets six and points people at them. Setting up stops being
 * thirteen decisions per person and becomes two.
 *
 * It also moves the Code on Wages 50% check from per-person to per-grade. Six
 * places to be wrong instead of forty-eight, and the split bar shows it before
 * anything is saved rather than reporting it afterwards as an error.
 */
export default function GradesTab({ base }: { base: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [raising, setRaising] = useState<Grade | null>(null);
  const [raisePct, setRaisePct] = useState('5');
  const [raiseFrom, setRaiseFrom] = useState(nextMonthISO);
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({ queryKey: ['pay-settings'], enabled: !!host, queryFn: () => api.get<SalarySettings>('/payroll/settings') });
  const grades = useQuery({ queryKey: ['pay-grades'], enabled: !!host, queryFn: () => api.get<Grade[]>('/payroll/grades') });
  const suggest = useQuery({
    queryKey: ['pay-grades-suggest'],
    enabled: !!host && grades.data?.length === 0,
    queryFn: () => api.get<SuggestedGrade[]>('/payroll/grades/suggest'),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['pay-grades'] });
    void qc.invalidateQueries({ queryKey: ['pay-grades-suggest'] });
    void qc.invalidateQueries({ queryKey: ['pay-overview'] });
    void qc.invalidateQueries({ queryKey: ['pay-people'] });
  };

  const save = useMutation({
    mutationFn: (d: Draft) => api.post('/payroll/grades', {
      id: d.id,
      name: d.name.trim(),
      description: d.description.trim() || undefined,
      bandMinMinor: toMinor(d.bandMin),
      bandMaxMinor: toMinor(d.bandMax),
      // Only the one override a school ever actually changes. Everything else
      // follows from it, because house rent is a percentage OF basic and the
      // balance absorbs the rest.
      overrides: d.basicPct.trim() ? { basic: { rateBps: Math.round(Number(d.basicPct) * 100) } } : {},
    }),
    onSuccess: () => { setDraft(null); setError(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.post(`/payroll/grades/${id}/remove`, {}),
    onSuccess: () => { setDraft(null); setError(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const raise = useMutation({
    mutationFn: (v: { gradeId: string; percentBps: number; effectiveFrom: string }) => api.post('/payroll/grades/raise', v),
    onSuccess: () => { setRaising(null); setError(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const acceptAll = useMutation({
    mutationFn: async (rows: SuggestedGrade[]) => {
      // One at a time on purpose: the name is unique per school, so a clash
      // must fail for that grade alone rather than abandoning the rest.
      for (const r of rows) {
        await api.post('/payroll/grades', {
          name: r.name, description: r.description,
          bandMinMinor: r.bandMinMinor, bandMaxMinor: r.bandMaxMinor,
          order: r.order, overrides: {},
        });
      }
    },
    onSuccess: () => { setError(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  if (grades.isError) return <QueryError error={grades.error} onRetry={grades.refetch} className="py-8" />;

  const rows = grades.data ?? [];
  const s = settings.data;
  const total = rows.reduce((a, g) => a + g.monthlyMinor, 0);
  const onPay = rows.reduce((a, g) => a + g.headcount, 0);

  return (
    <div className="sk-paystack">
      {error ? <div className="sk-state" role="alert" style={{ color: 'var(--sk-bad)' }}>{error}</div> : null}

      <Card>
        <CardHead>
          <h3>Grades</h3>
          <span className="flex flex-wrap items-center gap-2">
            <span className="sk-muted">
              {rows.length === 0 ? 'None yet' : `${rows.length} ${rows.length === 1 ? 'grade' : 'grades'} · ${onPay} on pay · ${rupees(total)} a month`}
            </span>
            <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={() => { setDraft({ ...BLANK }); setError(null); }}>
              Add a grade
            </button>
          </span>
        </CardHead>
        <CardBody className="grid gap-3">
          {rows.length === 0 ? (
            <>
              <EmptyRow>
                A grade holds the band and the split for one job, so putting someone on the payroll
                needs only a grade and a figure.
              </EmptyRow>
              {suggest.data && suggest.data.length > 0 ? (
                <Card>
                  <CardHead>
                    <h3>Drafted from your roll</h3>
                    <button
                      type="button" className="sk-btn sk-press" data-variant="primary"
                      disabled={acceptAll.isPending}
                      onClick={() => acceptAll.mutate(suggest.data!)}
                    >
                      {acceptAll.isPending ? 'Adding…' : `Add all ${suggest.data.length}`}
                    </button>
                  </CardHead>
                  <CardBody className="grid gap-2">
                    <Note>
                      <span>
                        These come from the jobs already on your roll, and any band from the pay you
                        have already set. Nothing is saved until you add them, and every one can be
                        edited afterwards.
                      </span>
                    </Note>
                    {suggest.data.map((g) => (
                      <div key={g.name} className="sk-payrow">
                        <span className="who">
                          <span className="nm">{g.name}</span>
                          <span className="meta">
                            {g.description} · {g.headcount} {g.headcount === 1 ? 'person' : 'people'}
                            {g.bandMaxMinor > 0 ? ` · ${rupees(g.bandMinMinor)} – ${rupees(g.bandMaxMinor)}` : ' · no band yet'}
                          </span>
                        </span>
                        <button
                          type="button" className="sk-btn" data-size="sm"
                          onClick={() => setDraft({
                            name: g.name, description: g.description,
                            bandMin: g.bandMinMinor ? String(Math.round(g.bandMinMinor / 100)) : '',
                            bandMax: g.bandMaxMinor ? String(Math.round(g.bandMaxMinor / 100)) : '',
                            basicPct: '',
                          })}
                        >
                          Edit first
                        </button>
                      </div>
                    ))}
                  </CardBody>
                </Card>
              ) : null}
            </>
          ) : (
            <div className="sk-paygrades">
              {rows.map((g) => (
                <div key={g.id} className="sk-paygrade">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="gname">{g.name}</span>
                    <span className="sk-pill" data-tone={g.headcount > 0 ? 'info' : 'neutral'}>
                      {g.headcount} {g.headcount === 1 ? 'person' : 'people'}
                    </span>
                  </div>
                  {g.description ? <span className="gdesc">{g.description}</span> : null}

                  {g.bandMaxMinor > 0 ? (
                    <>
                      <BandBar min={g.bandMinMinor} max={g.bandMaxMinor} />
                      <div className="sk-paybandends">
                        <span>{rupees(g.bandMinMinor)}</span>
                        <span>{rupees(g.bandMaxMinor)}</span>
                      </div>
                    </>
                  ) : (
                    <span className="gdesc">No band set — any figure is accepted.</span>
                  )}

                  <SplitBar split={g.split} />

                  {g.overshootMinor > 0 ? (
                    <Note>
                      <span>
                        The parts of this split add up to {rupees(g.overshootMinor)} a month more
                        than the pay itself. Anyone on it would be paid more than agreed — lower
                        Basic&rsquo;s share.
                      </span>
                    </Note>
                  ) : null}
                  {g.wageShareNote ? (
                    <Note><span>{g.wageShareNote}</span></Note>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="sk-btn" data-size="sm" onClick={() => { setDraft(draftOf(g)); setError(null); }}>
                      Edit
                    </button>
                    {g.headcount > 0 ? (
                      <button type="button" className="sk-btn" data-size="sm" onClick={() => { setRaising(g); setError(null); }}>
                        Raise this grade
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          {s ? <RulesAsAt asAt={s.pack.rulesAsAt} version={s.pack.version} /> : null}
        </CardBody>
      </Card>

      {/* ── the editor ──────────────────────────────────────────────────
          A drawer, so pressing a button on a long list visibly does
          something instead of opening a panel below the fold. */}
      {draft ? (
        <div className="sk-payscrim" role="dialog" aria-modal="true" aria-label={draft.id ? `Edit ${draft.name}` : 'Add a grade'} onClick={(e) => { if (e.target === e.currentTarget) setDraft(null); }}>
          <div className="sk-paydrawer">
            <div className="flex items-baseline justify-between gap-3">
              <span style={{ fontFamily: 'var(--sk-serif)', fontSize: 18, fontWeight: 650 }}>
                {draft.id ? draft.name : 'Add a grade'}
              </span>
              <button type="button" className="sk-btn" data-size="sm" onClick={() => setDraft(null)}>Close</button>
            </div>

            <label className="sk-payfield">
              <span className="lab">Name</span>
              <input
                className="sk-input" value={draft.name} maxLength={40} autoFocus
                placeholder="TGT"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <span className="hint">Short, the way the school says it out loud.</span>
            </label>

            <label className="sk-payfield">
              <span className="lab">What it means</span>
              <input
                className="sk-input" value={draft.description} maxLength={80}
                placeholder="Trained Graduate Teacher"
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <label className="sk-payfield" style={{ flex: '1 1 130px' }}>
                <span className="lab">Band from</span>
                <input className="sk-input" inputMode="numeric" value={draft.bandMin} placeholder="30000"
                  onChange={(e) => setDraft({ ...draft, bandMin: e.target.value })} />
              </label>
              <label className="sk-payfield" style={{ flex: '1 1 130px' }}>
                <span className="lab">Band to</span>
                <input className="sk-input" inputMode="numeric" value={draft.bandMax} placeholder="46000"
                  onChange={(e) => setDraft({ ...draft, bandMax: e.target.value })} />
              </label>
            </div>
            <span className="sk-muted" style={{ fontSize: 12 }}>
              A band is guidance. Paying outside it is allowed and only ever warns.
            </span>

            <label className="sk-payfield">
              <span className="lab">Basic, as a share of pay</span>
              <input className="sk-input" inputMode="decimal" value={draft.basicPct} placeholder="50"
                onChange={(e) => setDraft({ ...draft, basicPct: e.target.value })} />
              <span className="hint">
                Leave it blank for the school&rsquo;s own split, which is already 50% and already meets
                the law. Raise it only where a job genuinely differs.
              </span>
            </label>

            <div className="sk-paydrawer-actions">
              {draft.id ? (
                <button
                  type="button" className="sk-btn" disabled={remove.isPending}
                  onClick={() => remove.mutate(draft.id!)}
                >
                  {remove.isPending ? 'Removing…' : 'Remove'}
                </button>
              ) : <span />}
              <button
                type="button" className="sk-btn sk-press" data-variant="primary"
                disabled={save.isPending || !draft.name.trim()}
                onClick={() => save.mutate(draft)}
              >
                {save.isPending ? 'Saving…' : draft.id ? 'Save' : 'Add grade'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── the April job ─────────────────────────────────────────────── */}
      {raising ? (
        <div className="sk-payscrim" role="dialog" aria-modal="true" aria-label={`Raise ${raising.name}`} onClick={(e) => { if (e.target === e.currentTarget) setRaising(null); }}>
          <div className="sk-paydrawer">
            <div className="flex items-baseline justify-between gap-3">
              <span style={{ fontFamily: 'var(--sk-serif)', fontSize: 18, fontWeight: 650 }}>Raise {raising.name}</span>
              <button type="button" className="sk-btn" data-size="sm" onClick={() => setRaising(null)}>Close</button>
            </div>

            <p className="sk-muted" style={{ fontSize: 13 }}>
              All {raising.headcount} {raising.headcount === 1 ? 'person' : 'people'} on {raising.name} move together,
              from one date. Backdating is fine — the month works out the arrears by itself.
            </p>

            <label className="sk-payfield">
              <span className="lab">Raise by</span>
              <input className="sk-input" inputMode="decimal" value={raisePct}
                onChange={(e) => setRaisePct(e.target.value)} />
              <span className="hint">Per cent of what each person is paid now.</span>
            </label>

            <label className="sk-payfield">
              <span className="lab">From</span>
              <input className="sk-input" type="date" value={raiseFrom} onChange={(e) => setRaiseFrom(e.target.value)} />
            </label>

            <div className="sk-paytakehome">
              <div className="r">
                <span>Now</span>
                <span>{rupees(raising.monthlyMinor)} a month</span>
              </div>
              <div className="r" data-total>
                <span>After</span>
                <span>{rupees(Math.round(raising.monthlyMinor * (1 + (Number(raisePct) || 0) / 100)))} a month</span>
              </div>
            </div>

            <div className="sk-paydrawer-actions">
              <span />
              <button
                type="button" className="sk-btn sk-press" data-variant="primary"
                disabled={raise.isPending || !(Number(raisePct) > 0) || !raiseFrom}
                onClick={() => raise.mutate({
                  gradeId: raising.id,
                  percentBps: Math.round(Number(raisePct) * 100),
                  effectiveFrom: raiseFrom,
                })}
              >
                {raise.isPending ? 'Raising…' : `Raise ${raising.headcount} ${raising.headcount === 1 ? 'person' : 'people'}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { todayISO };
