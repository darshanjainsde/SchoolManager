'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
export default function OwnerJobsPage() {
  const api = useApi({ hostHeader: 'owner.sckools.com', audience: 'platform' });
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Jobs</h1>
        <p className="text-sm text-slate-500">
          Vacancies waiting to go on the Sckools jobs board. Approving one publishes it on sckools.com/jobs.
        </p>
      </div>

      <div className="flex gap-2">
        {['PENDING', 'APPROVED', 'REJECTED'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              status === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {(jobs ?? []).map((job) => (
          <Card key={job.id}>
            <CardHeader>
              <CardTitle>{job.title}</CardTitle>
              <p className="text-sm text-slate-500">
                {job.school.name}
                {job.posts > 1 ? ` · ${job.posts} positions` : ''}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="whitespace-pre-line text-sm text-slate-700">{job.description}</p>
              {status === 'PENDING' && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => moderate.mutate({ id: job.id, decision: 'APPROVE' })}>
                    Approve
                  </Button>
                  <Input
                    aria-label={`Reason for rejecting ${job.title}`}
                    placeholder="Reason (required to reject)"
                    value={reasons[job.id] ?? ''}
                    onChange={(e) => setReasons((r) => ({ ...r, [job.id]: e.target.value }))}
                    className="max-w-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!reasons[job.id]?.trim()}
                    onClick={() =>
                      moderate.mutate({ id: job.id, decision: 'REJECT', reason: reasons[job.id] })
                    }
                  >
                    Reject
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {(jobs ?? []).length === 0 && <p className="text-sm text-slate-500">Nothing here.</p>}
      </div>
    </div>
  );
}
