'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LeaveApplication, LeaveBalanceResponse, LeaveTypeValue } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { RequestList, type RequestItem } from '@/components/teacher/RequestList';
import { LeaveForm } from '@/components/teacher/LeaveForm';
import { ConfirmDialog } from '@/components/teacher/ConfirmDialog';

const LEAVE_TYPE_LABEL: Record<LeaveTypeValue, string> = {
  SICK: 'Sick leave', CASUAL: 'Casual leave', EARNED: 'Earned leave', UNPAID: 'Unpaid leave', OTHER: 'Other',
};

const formatDate = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function toItem(a: LeaveApplication): RequestItem {
  const same = a.startDate.slice(0, 10) === a.endDate.slice(0, 10);
  return {
    kind: 'leave',
    id: a.id,
    title: LEAVE_TYPE_LABEL[a.type] ?? a.type,
    detail: a.halfDay
      ? `${formatDate(a.startDate)} · half day`
      : same ? formatDate(a.startDate) : `${formatDate(a.startDate)} – ${formatDate(a.endDate)}`,
    reason: a.reason,
    status: a.status,
    createdAt: a.createdAt,
    cancellable: a.status === 'PENDING' || a.status === 'APPROVED',
  };
}

/**
 * MY LEAVE — for everybody the school employs who does not teach.
 *
 * The same form and the same list a teacher gets, on purpose. A driver's two
 * days off is the same transaction as a teacher's: it is applied for, it is
 * approved, and if it goes past the quota it reaches their pay. Building a
 * second, lesser screen for non-teaching staff would have said the opposite.
 *
 * What is NOT here is the substitution machinery — nobody covers a driver's
 * periods, because a driver has none. The server makes the same split.
 */
export default function StaffLeavePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [formKey, setFormKey] = useState(0);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const mine = useQuery({
    queryKey: ['staff-leave-mine'], enabled: !!host,
    queryFn: () => api.get<LeaveApplication[]>('/manage/leave/mine'),
  });

  // No policy configured, or an older API: the chips simply do not appear.
  const balance = useQuery({
    queryKey: ['staff-leave-balance'], enabled: !!host, retry: false,
    queryFn: () => api.get<LeaveBalanceResponse>('/manage/leave-policy/my-balance'),
  });

  const apply = useMutation({
    mutationFn: (v: { type: string; startDate: string; endDate: string; reason?: string; halfDay?: boolean }) =>
      api.post<LeaveApplication>('/manage/leave', v),
    onSuccess: () => {
      toast.success('Leave applied for — the office will review it.');
      setFormKey((k) => k + 1);
      void qc.invalidateQueries({ queryKey: ['staff-leave-mine'] });
      void qc.invalidateQueries({ queryKey: ['staff-leave-balance'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post<{ status: string }>(`/manage/leave/${id}/cancel`),
    onSuccess: () => {
      toast.success('Leave cancelled.');
      setConfirmCancelId(null);
      void qc.invalidateQueries({ queryKey: ['staff-leave-mine'] });
      void qc.invalidateQueries({ queryKey: ['staff-leave-balance'] });
    },
    onError: (e: Error) => { toast.error(e.message); setConfirmCancelId(null); },
  });

  const items = (mine.data ?? []).map(toItem);
  const chips = (balance.data?.balances ?? []).filter((b) => b.remaining !== null);

  return (
    <>
      <header className="sk-pagehead">
        <h1>My leave</h1>
        <p>Apply for leave and see where each request has got to.</p>
      </header>

      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Apply for leave</h3>
          {chips.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {chips.map((b) => (
                <span key={b.typeDefId} className="sk-pill" data-tone={(b.remaining ?? 0) <= 0 ? 'warn' : 'info'}>
                  {b.name} · {b.remaining} of {(b.allotted ?? 0) + b.carriedIn} left
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="sk-card-b">
          <LeaveForm
            key={formKey}
            isSubmitting={apply.isPending}
            remainingByType={Object.fromEntries(
              (balance.data?.balances ?? [])
                .filter((b) => b.builtin !== null)
                .map((b) => [b.builtin as string, b.remaining]),
            )}
            onSubmit={(v) => apply.mutate(v)}
          />
          <p className="sk-muted" style={{ fontSize: 12, marginTop: 10 }}>
            Days past what you are allowed can be taken off that month&rsquo;s pay. The office decides each one — nothing
            is deducted automatically.
          </p>
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>My requests</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>{items.length} total</p>
        </div>
        <div className="sk-card-b">
          {mine.isLoading ? <p className="sk-state">Loading your leave…</p> : null}
          {mine.error ? <p className="sk-state err">{(mine.error as Error).message}</p> : null}
          {mine.data ? (
            <RequestList items={items} onCancelLeave={(id) => setConfirmCancelId(id)} cancellingId={cancel.isPending ? (cancel.variables ?? null) : null} />
          ) : null}
        </div>
      </div>

      {confirmCancelId ? (
        <ConfirmDialog
          titleId="cancel-leave-title"
          title="Cancel this leave?"
          isPending={cancel.isPending}
          confirmLabel="Yes, cancel it"
          pendingLabel="Cancelling…"
          onConfirm={() => cancel.mutate(confirmCancelId)}
          onCancel={() => setConfirmCancelId(null)}
        >
          <p>The office will see that it has been withdrawn.</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
