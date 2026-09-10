'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarRange } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { fmtDate, type Overview, type YearRow } from './types';
import NextSessionStep from './steps/next-session';
import ClassesStep from './steps/classes';
import DecideStep from './steps/decide';
import RollNumbersStep from './steps/roll-numbers';
import CopyRestStep from './steps/copy-rest';
import ReviewStep from './steps/review';
import Register from './register';
import './print.css';

const STEPS = ['Next session', 'Classes', 'Decide students', 'Roll numbers', 'Copy the rest', 'Review & start'];

/**
 * Sessions (Active Roster, Track C): the year end as six steps. One plan at a
 * time; nothing about a child changes until Start on the last step.
 */
export default function SessionsPage() {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();
  const overview = useQuery<Overview>({
    queryKey: ['sessions', host],
    queryFn: () => api.get('/manage/sessions'),
    enabled: !!host,
  });
  const me = useQuery<{ features?: string[] }>({
    queryKey: ['me', host],
    queryFn: () => api.get('/auth/me'),
    enabled: !!host,
    staleTime: 5 * 60_000,
  });
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [registerYear, setRegisterYear] = useState<YearRow | null>(null);
  // On a phone the six steps scroll sideways; the active one must be in view.
  const stepsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = stepsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, [step]);

  const plan = overview.data?.plan ?? null;
  const years = overview.data?.years ?? [];
  const current = years.find((y) => y.isCurrent) ?? null;

  // The saved step: no classes mapped yet → Classes; scheduled → Review; else Decide.
  useEffect(() => {
    if (plan && step === null) setStep(plan.status === 'SCHEDULED' ? 5 : Object.keys(plan.sectionMap ?? {}).length === 0 ? 1 : 2);
    if (!plan && step !== null) setStep(null);
  }, [plan, step]);

  const cancel = useMutation({
    mutationFn: () => api.post('/manage/sessions/plan/cancel', {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions', host] });
      setStep(null);
      toast.success('Plan cancelled — nothing changed');
    },
    onError: (err: Error) => toast.error(`Could not cancel: ${err.message}`),
  });
  const onCancel = () => {
    if (window.confirm('Cancel this plan? Every decision saved so far is discarded. Nothing about any child has changed.')) cancel.mutate();
  };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['sessions', host] });

  if (registerYear) {
    return (
      <div className="flex flex-col gap-6">
        <header className="sk-pagehead" style={{ marginBottom: 0 }}>
          <h1>Sessions</h1>
          <p>The promotion register.</p>
        </header>
        <Register year={registerYear} onBack={() => setRegisterYear(null)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="sk-pagehead" style={{ marginBottom: 0 }}>
        <h1>Sessions</h1>
        <p>Close the year, open the next one, move every child in one go.</p>
      </header>

      {overview.isLoading && <p className="sk-muted">Loading…</p>}
      {overview.isError && <p className="text-sm text-rose-600">Could not load sessions: {(overview.error as Error).message}</p>}

      {overview.data && !plan && !creating && (
        <>
          <div className="sk-ses-yearsgrid">
            {years.length === 0 && (
              <div className="sk-card">
                <div className="sk-card-b">
                  <p className="sk-muted">No academic years yet. Add the current one under Settings → Academic years, then come back here.</p>
                </div>
              </div>
            )}
            {[...years].reverse().map((y) => (
              <div key={y.id} className="sk-card sk-ses-yearcard" data-current={y.isCurrent || undefined}>
                <div className="sk-card-b">
                  <div className="sk-ses-yearhead">
                    <b>{y.name}</b>
                    {y.isCurrent && (
                      <span className="sk-pill" data-tone="good">
                        Current
                      </span>
                    )}
                  </div>
                  <span className="sk-muted">
                    {fmtDate(y.startDate)} – {fmtDate(y.endDate)}
                  </span>
                  <span>
                    {y.students} students in {y.sections} classes
                  </span>
                  {!y.isCurrent && y.sections > 0 && (
                    <button type="button" className="sk-btn sk-press" onClick={() => setRegisterYear(y)}>
                      Register
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div>
            <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={!current} onClick={() => setCreating(true)}>
              <CalendarRange className="h-4 w-4" /> Start a new session
            </button>
            {!current && years.length > 0 && <p className="sk-cel-hint" style={{ marginTop: 6 }}>Mark the current year first (Settings → Academic years).</p>}
          </div>
        </>
      )}

      {overview.data && !plan && creating && (
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>1 · Next session</h3>
            <span className="sk-sub">Name the year that follows {current?.name ?? 'this one'}.</span>
          </div>
          <NextSessionStep current={current} plan={null} onCreated={() => { setCreating(false); setStep(1); }} onCancel={() => setCreating(false)} />
          <div className="sk-card-b" style={{ paddingTop: 0 }}>
            <button type="button" className="sk-btn sk-press" onClick={() => setCreating(false)}>
              Back
            </button>
          </div>
        </div>
      )}

      {plan && step !== null && (
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>
              {plan.fromYear.name} → {plan.toYear.name}
            </h3>
            <span className="sk-pill" data-tone={plan.status === 'SCHEDULED' ? 'info' : 'neutral'}>
              {plan.status === 'SCHEDULED' ? `Scheduled · ${fmtDate(plan.scheduledFor ?? plan.toYear.startDate)}` : 'Draft'}
            </span>
          </div>
          <div className="sk-steps" role="tablist" aria-label="New session steps" ref={stepsRef}>
            {STEPS.map((label, i) => (
              <button key={label} type="button" role="tab" aria-selected={step === i} onClick={() => setStep(i)}>
                <span className="n">{i + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <div className="sk-ses-stephead">
            <span className="sk-lab">
              {step + 1} · {STEPS[step]}
            </span>
          </div>
          {step === 0 && <NextSessionStep current={current} plan={plan} onCreated={refresh} onCancel={onCancel} />}
          {step === 1 && <ClassesStep plan={plan} onNext={() => setStep(2)} />}
          {step === 2 && <DecideStep plan={plan} onNext={() => setStep(3)} />}
          {step === 3 && <RollNumbersStep plan={plan} onNext={() => setStep(4)} />}
          {step === 4 && <CopyRestStep plan={plan} onNext={() => setStep(5)} />}
          {step === 5 && <ReviewStep plan={plan} features={me.data?.features ?? []} onCancel={onCancel} onStarted={() => setStep(null)} />}
        </div>
      )}
    </div>
  );
}
