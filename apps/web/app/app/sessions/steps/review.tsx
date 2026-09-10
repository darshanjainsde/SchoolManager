'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { fmtDate, type PlanView, type ReviewPayload } from '../types';

function errorCode(err: unknown): string | undefined {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') return (err.body as { code?: string }).code;
  return undefined;
}

function Kpi({ label, n, hint }: { label: string; n: number; hint?: string }) {
  return (
    <div className="sk-kpi">
      <span className="lab">{label}</span>
      <span className="n sk-num">{n.toLocaleString('en-IN')}</span>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/** Step 6. The whole plan in numbers, the warnings, and the one button that changes things. */
export default function ReviewStep({ plan, features, onCancel, onStarted }: { plan: PlanView; features: string[]; onCancel: () => void; onStarted: () => void }) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();
  const review = useQuery<ReviewPayload>({
    queryKey: ['session-review', host, plan.version],
    queryFn: () => api.get('/manage/sessions/plan/review'),
    enabled: !!host,
  });
  const [when, setWhen] = useState<'NOW' | 'ON_START_DATE'>('NOW');

  const start = useMutation({
    mutationFn: () => api.post<{ started?: true; scheduled?: true; scheduledFor?: string }>('/manage/sessions/plan/start', { when, version: review.data?.version }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions', host] });
      void queryClient.invalidateQueries({ queryKey: ['mng-students'] });
      void queryClient.invalidateQueries({ queryKey: ['mng-classes', host] });
      toast.success(r.scheduled ? `Scheduled — ${plan.toYear.name} starts on ${fmtDate(r.scheduledFor!)}` : `${plan.toYear.name} has started`);
      onStarted();
    },
    onError: (err: Error) => {
      if (errorCode(err) === 'PLAN_CHANGED') {
        toast.error('The plan changed since you opened this page. Reloading.');
        void queryClient.invalidateQueries({ queryKey: ['sessions', host] });
        void queryClient.invalidateQueries({ queryKey: ['session-review', host] });
      } else toast.error(`Could not start: ${err.message}`);
    },
  });

  const r = review.data;
  if (review.isLoading || !r) return <div className="sk-card-b"><p className="sk-muted">Adding it up…</p></div>;

  const warnings: { text: string; tone: 'warn' | 'info' }[] = [];
  if (r.counts.undecided > 0) warnings.push({ text: `${r.counts.undecided} children have no decision yet — go back to step 3.`, tone: 'warn' });
  if (r.counts.unplaced > 0) warnings.push({ text: `${r.counts.unplaced} active children have no class and will not move; seat them from Students if they should.`, tone: 'info' });
  if (r.sectionsWithoutClassTeacher.length > 0) warnings.push({ text: `No class teacher yet: ${r.sectionsWithoutClassTeacher.join(', ')}.`, tone: 'info' });
  if (r.counts.passOut > 0 && r.alumniWithoutEmail > 0) warnings.push({ text: `${r.alumniWithoutEmail} of the ${r.counts.passOut} passing out have no email — their alumni door cannot be sent. Add one before Start or hand it over later.`, tone: 'info' });
  if (r.libraryIssuesOut > 0) warnings.push({ text: `${r.libraryIssuesOut} library books are still out across the school.`, tone: 'info' });
  if (r.counts.passOut > 0 && !features.includes('ALUMNI')) warnings.push({ text: `Turn on the Alumni wing to give the Class of ${plan.fromYear.name} their alumni door — without it they leave as alumni in the register only.`, tone: 'info' });

  const scheduled = r.status === 'SCHEDULED';
  return (
    <div className="sk-card-b">
      <div className="sk-kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 120px), 1fr))' }}>
        <Kpi label="Promoted" n={r.counts.promote} />
        <Kpi label="Stay in grade" n={r.counts.stay} />
        <Kpi label="Pass out" n={r.counts.passOut} hint={features.includes('ALUMNI') ? 'become alumni · Homecoming' : 'become alumni'} />
        <Kpi label="Leaving" n={r.counts.leave} />
        <Kpi label="New admissions" n={r.counts.newAdmissions} hint={`already in ${plan.toYear.name}`} />
      </div>
      {warnings.length > 0 && (
        <div className="sk-notice">
          <p className="nt">Before you start</p>
          {warnings.map((w) => (
            <p key={w.text} className="nd">
              {w.text}
            </p>
          ))}
        </div>
      )}
      <p className="sk-muted">
        Start moves every seat, makes the Class of {plan.fromYear.name} alumni, closes leavers’ logins, makes {plan.toYear.name} the current session
        {r.copyTimetable ? ', copies the timetable' : ''}
        {r.carryLeave ? ', carries leave forward' : ''}, and tells families and teachers. It runs once and cannot be undone.
      </p>
      {scheduled ? (
        <div className="sk-notice">
          <p className="nt">Scheduled</p>
          <p className="nd">
            {plan.toYear.name} starts by itself on {fmtDate(r.scheduledFor ?? plan.toYear.startDate)} at midnight. Cancel the plan to change anything before then.
          </p>
        </div>
      ) : (
        <div className="sk-cel-styles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
          <button type="button" className="sk-cel-style" aria-pressed={when === 'NOW'} onClick={() => setWhen('NOW')}>
            <b>Start now</b>
            <small>Everything moves the moment you press Start.</small>
          </button>
          <button type="button" className="sk-cel-style" aria-pressed={when === 'ON_START_DATE'} onClick={() => setWhen('ON_START_DATE')}>
            <b>Start on {fmtDate(plan.toYear.startDate)}</b>
            <small>Decide now; the session starts by itself that morning.</small>
          </button>
        </div>
      )}
      <div className="sk-cel-actions">
        {!scheduled && (
          <button
            type="button"
            className="sk-btn sk-press"
            data-variant="primary"
            disabled={r.counts.undecided > 0 || start.isPending}
            onClick={() => {
              const what = `${r.counts.promote + r.counts.stay} children move, ${r.counts.passOut} pass out, ${r.counts.leave} leave.`;
              const ask = when === 'NOW' ? `Start ${plan.toYear.name} now? ${what} This runs once and cannot be undone.` : `Schedule ${plan.toYear.name} to start on ${fmtDate(plan.toYear.startDate)}? ${what}`;
              if (window.confirm(ask)) start.mutate();
            }}
          >
            {start.isPending ? 'Starting…' : when === 'NOW' ? `Start ${plan.toYear.name}` : 'Schedule the start'}
          </button>
        )}
        {features.includes('FEES') && (
          <Link href="/app/fees" className="sk-btn sk-press" style={{ textDecoration: 'none' }}>
            Set up fees for {plan.toYear.name}
          </Link>
        )}
        <button type="button" className="sk-btn sk-press" data-tone="bad" onClick={onCancel}>
          Cancel this plan
        </button>
      </div>
    </div>
  );
}
