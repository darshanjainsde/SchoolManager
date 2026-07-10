'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Inbox, Mail, Phone } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';

interface Enquiry {
  id: string;
  parentName: string;
  phone: string;
  email: string | null;
  gradeInterest: string | null;
  message: string | null;
  status: 'NEW' | 'CONTACTED' | 'CLOSED';
  createdAt: string;
}

const STATUSES = ['NEW', 'CONTACTED', 'CLOSED'] as const;
const STATUS_STYLES: Record<Enquiry['status'], string> = {
  NEW: 'bg-teal-100 text-teal-700',
  CONTACTED: 'bg-amber-100 text-amber-700',
  CLOSED: 'bg-slate-200 text-slate-500',
};

// Fixed locale/timezone-agnostic-enough format; admin-only page so a slight
// locale variance is fine (no SSR hydration concern — client component).
function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}

export default function EnquiriesPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'ALL' | Enquiry['status']>('ALL');

  const { data, isLoading, error } = useQuery({
    queryKey: ['site-enquiries'],
    queryFn: () => api.get<Enquiry[]>('/site/enquiries'),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    enabled: !!host,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Enquiry['status'] }) =>
      api.request(`/site/enquiries/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['site-enquiries'] });
      toast.success('Status updated');
    },
    onError: (e: Error) => toast.error(`Failed to update: ${e.message}`),
  });

  const enquiries = data ?? [];
  const filtered = filter === 'ALL' ? enquiries : enquiries.filter((e) => e.status === filter);
  const newCount = enquiries.filter((e) => e.status === 'NEW').length;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Enquiries</h1>
        <p className="text-sm text-slate-500">
          Leads from your website — the enquiry form, and &ldquo;request a call&rdquo; from course cards.
          {newCount > 0 && <span className="ml-1 font-semibold text-teal-700">{newCount} new.</span>}
        </p>
      </div>

      <div className="flex gap-2">
        {(['ALL', ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition',
              filter === s ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            {s === 'ALL' ? `All (${enquiries.length})` : `${s.charAt(0)}${s.slice(1).toLowerCase()} (${enquiries.filter((e) => e.status === s).length})`}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading enquiries…</p>}
      {error && <p className="text-sm text-rose-600">{(error as Error).message}</p>}
      {!isLoading && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 p-12 text-center text-slate-400">
          <Inbox className="mx-auto mb-3 h-8 w-8" />
          {enquiries.length === 0
            ? 'No enquiries yet — they appear here as soon as someone submits the form on your website.'
            : 'Nothing with this status.'}
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((e) => (
          <Card key={e.id}>
            <CardContent className="flex flex-wrap items-start gap-4 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{e.parentName}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', STATUS_STYLES[e.status])}>{e.status}</span>
                  {e.gradeInterest && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {e.gradeInterest}
                    </span>
                  )}
                  <span className="text-xs text-slate-400">{formatDate(e.createdAt)}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
                  <a href={`tel:${e.phone}`} className="inline-flex items-center gap-1.5 hover:text-teal-700">
                    <Phone className="h-3.5 w-3.5" /> {e.phone}
                  </a>
                  {e.email && (
                    <a href={`mailto:${e.email}`} className="inline-flex items-center gap-1.5 hover:text-teal-700">
                      <Mail className="h-3.5 w-3.5" /> {e.email}
                    </a>
                  )}
                </div>
                {e.message && <p className="mt-2 text-sm text-slate-500">{e.message}</p>}
              </div>
              <div className="flex gap-1.5">
                {STATUSES.filter((s) => s !== e.status).map((s) => (
                  <Button
                    key={s}
                    variant="outline"
                    size="sm"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ id: e.id, status: s })}
                  >
                    Mark {s.toLowerCase()}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
