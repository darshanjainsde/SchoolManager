'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';

interface OwnerJob {
  id: string;
  title: string;
  summary: string;
  description: string;
  posts: number;
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CLOSED';
  school: { name: string; slug: string };
}

/**
 * The vacancy queue.
 *
 * Deliberately the same desk as network events: §6 — a second moderation queue
 * is how one of them stops being read. The owner moderates VACANCIES and never
 * sees an application; there is no endpoint here that returns a candidate.
 */
/** The queue's own colour: ours to act on, published, or turned away. */
const TONE: Record<string, string> = { PENDING: 'warn', APPROVED: 'good', REJECTED: 'neutral' };

export default function OwnerJobsPage() {
  // OWNER_HOST, never a literal: lib/hosts.ts is the only place the
  // deployment's domain is named. Hardcoding the production host meant this
  // page sent owner.sckools.com on staging, where the owner-host guard
  // answers 403 — the queue never loaded a single vacancy there.
  const api = useApi({ hostHeader: OWNER_HOST, audience: 'platform' });
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('PENDING');
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const { data: jobs } = useQuery<OwnerJob[]>({
    queryKey: ['owner-jobs', status],
    queryFn: () => api.get(`/owner/jobs?status=${status}`),
  });

  const moderate = useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: 'APPROVE' | 'REJECT'; reason?: string }) =>
      api.patch(`/owner/jobs/${id}`, { decision, reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['owner-jobs'] });
      toast.success('Done');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <header className="sk-own-head">
        <div>
          <h1>Jobs</h1>
          <p>
            Vacancies waiting to go on the Sckools jobs board. Approving one publishes it
            on sckools.com/jobs.
          </p>
        </div>
      </header>

      <div className="sk-own-tabs" role="tablist" aria-label="Vacancy queue">
        {['PENDING', 'APPROVED', 'REJECTED'].map((s) => (
          <button key={s} type="button" role="tab" className="sk-own-tab"
            aria-selected={status === s} onClick={() => setStatus(s)}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {(jobs ?? []).map((job) => (
        <article key={job.id} className="sk-own-order" data-tone={TONE[status] ?? 'neutral'}>
          <div className="sk-own-order-top">
            <div style={{ minWidth: 0 }}>
              <h2 className="sk-own-order-title">
                {job.title}
                {job.posts > 1 && <span className="sk-pill" data-tone="info">{job.posts} positions</span>}
              </h2>
              <p className="sk-own-order-meta">{job.school.name}</p>
              <p className="sk-own-order-spec" style={{ whiteSpace: 'pre-line', marginTop: 8 }}>
                {job.description}
              </p>
            </div>
          </div>

          {status === 'PENDING' && (
            <div className="sk-own-acts">
              <button type="button" className="sk-own-btn" data-kind="good"
                onClick={() => moderate.mutate({ id: job.id, decision: 'APPROVE' })}>
                <Check size={14} aria-hidden="true" /> Approve — publishes it
              </button>
              <label className="sk-own-field grow">
                <span>Reason — required to reject, and the school reads it</span>
                <input value={reasons[job.id] ?? ''}
                  aria-label={`Reason for rejecting ${job.title}`}
                  onChange={(e) => setReasons((r) => ({ ...r, [job.id]: e.target.value }))} />
              </label>
              <button type="button" className="sk-own-btn" data-kind="danger"
                disabled={!reasons[job.id]?.trim()}
                onClick={() => moderate.mutate({ id: job.id, decision: 'REJECT', reason: reasons[job.id] })}>
                <X size={14} aria-hidden="true" /> Reject
              </button>
            </div>
          )}
        </article>
      ))}

      {(jobs ?? []).length === 0 && (
        <p className="sk-own-state">
          <b>Nothing in this pile.</b>
          A school posting a vacancy puts it under <b style={{ display: 'inline' }}>Pending</b> for you to read.
        </p>
      )}
    </>
  );
}
