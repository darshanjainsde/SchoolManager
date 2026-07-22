'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ─────────────────────────────────────────────────────────────────────

type LeaveType = 'SICK' | 'CASUAL' | 'EARNED' | 'UNPAID' | 'OTHER';
type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** Dates arrive as ISO strings over the wire even though the API types them as Date. */
interface LeaveApplication {
  id: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LeaveStatus;
  createdAt: string;
}

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: 'SICK', label: 'Sick leave' },
  { value: 'CASUAL', label: 'Casual leave' },
  { value: 'EARNED', label: 'Earned leave' },
  { value: 'UNPAID', label: 'Unpaid leave' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_TONE: Record<LeaveStatus, 'warn' | 'good' | 'bad' | 'info'> = {
  PENDING: 'warn',
  APPROVED: 'good',
  REJECTED: 'bad',
  CANCELLED: 'info',
};

const EMPTY_FORM = { type: 'SICK' as LeaveType, startDate: '', endDate: '', reason: '' };

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function typeLabel(type: LeaveType): string {
  return LEAVE_TYPES.find((t) => t.value === type)?.label ?? type;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TeacherLeavePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [form, setForm] = useState(EMPTY_FORM);

  const mine = useQuery({
    queryKey: ['t-leave-mine'],
    enabled: !!host,
    queryFn: () => api.get<LeaveApplication[]>('/manage/leave/mine'),
  });

  const dateOrderInvalid = !!form.startDate && !!form.endDate && form.endDate < form.startDate;
  const canSubmit = !!form.startDate && !!form.endDate && !dateOrderInvalid;

  const apply = useMutation({
    mutationFn: () =>
      api.post<LeaveApplication>('/manage/leave', {
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success("Leave request submitted — your admin will review it.");
      setForm(EMPTY_FORM);
      void qc.invalidateQueries({ queryKey: ['t-leave-mine'] });
    },
    // { code, message } envelope — surface the message as-is.
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post<{ status: string; restoredDates: number }>(`/manage/leave/${id}/cancel`),
    onSuccess: () => {
      toast.success('Leave cancelled — your classes and attendance have been restored.');
      void qc.invalidateQueries({ queryKey: ['t-leave-mine'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onCancel(id: string) {
    if (!window.confirm('Cancel this leave? Your classes will be restored.')) return;
    cancel.mutate(id);
  }

  const applications = mine.data ?? [];

  return (
    <>
      <header className="sk-pagehead">
        <h1>Leave</h1>
        <p>Apply for leave and keep track of your requests.</p>
      </header>

      <div className="sk-card" style={{ marginBottom: 16 }}>
        <div className="sk-card-h">
          <h3>Apply for leave</h3>
        </div>
        <div className="sk-card-b">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="leave-type" className="sk-lab">
                Type
              </label>
              <Select
                id="leave-type"
                className={`${fieldCls} w-full`}
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LeaveType }))}
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div aria-hidden="true" className="hidden sm:block" />
            <div className="space-y-1.5">
              <label htmlFor="leave-from" className="sk-lab">
                From
              </label>
              <Input
                id="leave-from"
                type="date"
                className={`${fieldCls} w-full`}
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="leave-to" className="sk-lab">
                To
              </label>
              <Input
                id="leave-to"
                type="date"
                className={`${fieldCls} w-full`}
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="leave-reason" className="sk-lab">
                Reason (optional)
              </label>
              <Textarea
                id="leave-reason"
                rows={3}
                className={`${fieldCls} w-full`}
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="A short note for your admin"
              />
            </div>
            <div className="sm:col-span-2" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="sk-btn"
                data-variant="primary"
                disabled={!canSubmit || apply.isPending}
                onClick={() => apply.mutate()}
              >
                {apply.isPending ? 'Submitting…' : 'Submit request'}
              </button>
              {dateOrderInvalid && (
                <span className="sk-state err">The end date must be on or after the start date.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="sk-card">
        <div className="sk-card-h">
          <h3>My requests</h3>
          <p className="sk-muted" style={{ marginTop: 4 }}>
            {applications.length} total
          </p>
        </div>
        <div className="sk-card-b">
          {mine.isLoading && <p className="sk-state">Loading your requests…</p>}
          {mine.error && <p className="sk-state err">{(mine.error as Error).message}</p>}
          {!mine.isLoading && !mine.error && applications.length === 0 && (
            <p className="sk-state">No leave requests yet.</p>
          )}
          {applications.map((a) => {
            const cancellable = a.status === 'PENDING' || a.status === 'APPROVED';
            return (
              <div className="sk-row" key={a.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="nm">{typeLabel(a.type)}</div>
                  <div className="meta">
                    {formatDate(a.startDate)} – {formatDate(a.endDate)}
                    {a.reason ? ` · ${a.reason}` : ''}
                  </div>
                </div>
                <span className="sp" />
                {cancellable && (
                  <button
                    type="button"
                    className="sk-btn"
                    disabled={cancel.isPending}
                    onClick={() => onCancel(a.id)}
                    style={{ marginRight: 8 }}
                  >
                    Cancel
                  </button>
                )}
                <span className="sk-pill" data-tone={STATUS_TONE[a.status]}>
                  {a.status.charAt(0) + a.status.slice(1).toLowerCase()}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
