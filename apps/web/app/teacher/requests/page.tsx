'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { RegisterChangeRow } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { RequestList, type RequestItem } from '@/components/teacher/RequestList';
import { LeaveForm } from '@/components/teacher/LeaveForm';
import { ConfirmDialog } from '@/components/teacher/ConfirmDialog';

// ── Types ─────────────────────────────────────────────────────────────────────

type LeaveType = 'SICK' | 'CASUAL' | 'EARNED' | 'UNPAID' | 'OTHER';
type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/**
 * Dates arrive as ISO strings over the wire even though the API types them as
 * Date. No `@skoolos/types` counterpart exists yet for this shape — promoting
 * it to the shared package is Task 10's sweep, not this one's.
 */
interface LeaveApplication {
  id: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LeaveStatus;
  createdAt: string;
}

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  SICK: 'Sick leave',
  CASUAL: 'Casual leave',
  EARNED: 'Earned leave',
  UNPAID: 'Unpaid leave',
  OTHER: 'Other',
};

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function toLeaveItem(a: LeaveApplication): RequestItem {
  return {
    kind: 'leave',
    id: a.id,
    title: LEAVE_TYPE_LABEL[a.type] ?? a.type,
    detail: `${formatDate(a.startDate)} – ${formatDate(a.endDate)}`,
    reason: a.reason,
    status: a.status,
    createdAt: a.createdAt,
    cancellable: a.status === 'PENDING' || a.status === 'APPROVED',
  };
}

function toRegisterItem(r: RegisterChangeRow): RequestItem {
  return {
    kind: 'register',
    id: r.id,
    title: r.className,
    detail: formatDate(r.date),
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

/** Duck-typed rather than `instanceof ApiError` — tests reject with plain objects that carry `.status`. */
function isForbidden(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { status?: number }).status === 403;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TeacherRequestsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  // Bumped on a successful apply to remount (and so reset) LeaveForm — it has
  // no imperative reset handle of its own, by design (props only).
  const [formKey, setFormKey] = useState(0);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);

  const leaveQuery = useQuery({
    queryKey: ['t-leave-mine'],
    enabled: !!host,
    queryFn: () => api.get<LeaveApplication[]>('/manage/leave/mine'),
  });

  const registerQuery = useQuery({
    queryKey: ['t-register-changes-mine'],
    enabled: !!host,
    queryFn: () => api.get<RegisterChangeRow[]>('/manage/register-changes/mine'),
  });

  const apply = useMutation({
    mutationFn: (v: { type: string; startDate: string; endDate: string; reason?: string }) =>
      api.post<LeaveApplication>('/manage/leave', v),
    onSuccess: () => {
      toast.success('Leave request submitted — your admin will review it.');
      setFormKey((k) => k + 1);
      void qc.invalidateQueries({ queryKey: ['t-leave-mine'] });
    },
    // { code, message } envelope — surface the message as-is.
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post<{ status: string; restoredDates: number }>(`/manage/leave/${id}/cancel`),
    onSuccess: () => {
      toast.success('Leave cancelled — your classes and attendance have been restored.');
      setConfirmCancelId(null);
      void qc.invalidateQueries({ queryKey: ['t-leave-mine'] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmCancelId(null);
    },
  });

  const isLoading = leaveQuery.isLoading || registerQuery.isLoading;
  const bothForbidden = isForbidden(leaveQuery.error) && isForbidden(registerQuery.error);

  // Settled (not loading) and at least one side actually has data — the
  // difference between "nothing loaded" (don't even offer an empty list,
  // that would read as "you have zero requests" when really both calls
  // failed) and "one side loaded, the other didn't" (show what did load,
  // next to the failure, rather than silently rendering a half-list).
  const anyData = leaveQuery.data !== undefined || registerQuery.data !== undefined;

  const errorMessages = [...new Set([leaveQuery.error, registerQuery.error].filter(Boolean).map((e) => (e as Error).message))];

  const items: RequestItem[] = [
    ...(leaveQuery.data ?? []).map(toLeaveItem),
    ...(registerQuery.data ?? []).map(toRegisterItem),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const cancellingId = cancel.isPending ? (cancel.variables ?? null) : null;

  return (
    <>
      <header className="sk-pagehead">
        <h1>Requests</h1>
        <p>Leave applications and register-change requests, in one place.</p>
      </header>

      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Apply for leave</h3>
        </div>
        <div className="sk-card-b">
          <LeaveForm key={formKey} isSubmitting={apply.isPending} onSubmit={(v) => apply.mutate(v)} />
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>My requests</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            {items.length} total
          </p>
        </div>
        <div className="sk-card-b">
          {bothForbidden ? (
            <p className="sk-state err">
              This page is for teachers — sign in with a teacher account to see your requests.
            </p>
          ) : isLoading ? (
            <p className="sk-state">Loading your requests…</p>
          ) : (
            <>
              {errorMessages.map((msg) => (
                <p className="sk-state err" key={msg}>
                  {msg}
                </p>
              ))}
              {anyData && (
                <RequestList items={items} onCancelLeave={(id) => setConfirmCancelId(id)} cancellingId={cancellingId} />
              )}
            </>
          )}
        </div>
      </div>

      {confirmCancelId && (
        <ConfirmDialog
          titleId="cancel-leave-title"
          title="Cancel this leave?"
          isPending={cancel.isPending}
          confirmLabel="Yes, cancel leave"
          pendingLabel="Cancelling…"
          onConfirm={() => cancel.mutate(confirmCancelId)}
          onCancel={() => setConfirmCancelId(null)}
        >
          <p>Your classes and attendance for the cancelled dates will be restored.</p>
        </ConfirmDialog>
      )}
    </>
  );
}
