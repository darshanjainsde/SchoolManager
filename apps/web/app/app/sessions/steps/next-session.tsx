'use client';
import { useState, type CSSProperties } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { fmtDate, nextSessionDefaults, type PlanView, type YearRow } from '../types';

const field: CSSProperties = {
  display: 'block', width: '100%', border: '1px solid var(--sk-line-2)', borderRadius: 10, padding: '9px 11px',
  background: 'var(--sk-card)', color: 'var(--sk-ink)', fontSize: 13.5, fontFamily: 'inherit',
};

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.body && typeof err.body === 'object') {
    const b = err.body as { code?: string; message?: string };
    if (b.code === 'NO_CURRENT_YEAR') return 'Mark the current academic year first (Settings → Academic years).';
    if (b.message) return b.message;
  }
  return (err as Error).message;
}

/**
 * Step 1. In create mode: name the next session and its dates (prefilled from
 * the year that is closing) and open the plan. With a plan open: the two years
 * side by side and the one way out — Cancel this plan.
 */
export default function NextSessionStep({ current, plan, onCreated, onCancel }: { current: YearRow | null; plan: PlanView | null; onCreated: () => void; onCancel: () => void }) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();
  const defaults = current ? nextSessionDefaults(current) : { name: '', startDate: '', endDate: '' };
  const [name, setName] = useState(defaults.name);
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);

  const create = useMutation({
    mutationFn: () => api.post('/manage/sessions/plan', { name: name.trim(), startDate, endDate }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions', host] });
      toast.success(`Plan opened for ${name.trim()}`);
      onCreated();
    },
    onError: (err: Error) => toast.error(errorMessage(err)),
  });

  if (plan) {
    return (
      <div className="sk-card-b">
        <div className="sk-ses-years">
          <div className="sk-ses-year">
            <span className="sk-lab">Closing</span>
            <b>{plan.fromYear.name}</b>
            <span className="sk-muted">{fmtDate(plan.fromYear.startDate)} – {fmtDate(plan.fromYear.endDate)}</span>
          </div>
          <span className="sk-ses-arrow" aria-hidden="true">→</span>
          <div className="sk-ses-year">
            <span className="sk-lab">Next session</span>
            <b>{plan.toYear.name}</b>
            <span className="sk-muted">{fmtDate(plan.toYear.startDate)} – {fmtDate(plan.toYear.endDate)}</span>
          </div>
        </div>
        <p className="sk-muted">
          Nothing about a child changes until you press Start on the last step. You can come back to this plan over the next days.
        </p>
        <div>
          <button type="button" className="sk-btn sk-press" data-tone="bad" onClick={onCancel}>
            Cancel this plan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sk-card-b">
      {current ? (
        <p className="sk-muted">
          {current.name} is closing. Name the session that follows it — the classes, the children and the timetable are decided in the next steps.
        </p>
      ) : (
        <div className="sk-notice">
          <p className="nt">No current academic year</p>
          <p className="nd">Mark the current year first (Settings → Academic years), then come back here.</p>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="sk-lab">Session name</span>
          <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="2026-27" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="sk-lab">Starts</span>
          <input style={field} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="sk-lab">Ends</span>
          <input style={field} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <div>
        <button
          type="button"
          className="sk-btn sk-press"
          data-variant="primary"
          disabled={!current || !name.trim() || !startDate || !endDate || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Opening…' : 'Open the plan'}
        </button>
      </div>
    </div>
  );
}
