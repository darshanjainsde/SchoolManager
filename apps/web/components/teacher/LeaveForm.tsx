'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type LeaveType = 'SICK' | 'CASUAL' | 'EARNED' | 'UNPAID' | 'OTHER';

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: 'SICK', label: 'Sick leave' },
  { value: 'CASUAL', label: 'Casual leave' },
  { value: 'EARNED', label: 'Earned leave' },
  { value: 'UNPAID', label: 'Unpaid leave' },
  { value: 'OTHER', label: 'Other' },
];

const EMPTY_FORM = { type: 'SICK' as LeaveType, startDate: '', endDate: '', reason: '' };

const fieldCls =
  'rounded-[10px] border border-[var(--sk-line-2)] bg-[var(--sk-card)] px-[11px] py-[9px] text-[13.5px] text-[var(--sk-ink)] placeholder:text-[var(--sk-ink-3)] focus-visible:outline-none focus-visible:border-[var(--sk-brand)] focus-visible:shadow-[0_0_0_3px_var(--sk-brand-tint)] disabled:opacity-60 disabled:cursor-not-allowed';

export interface LeaveFormProps {
  isSubmitting: boolean;
  onSubmit: (v: { type: string; startDate: string; endDate: string; reason?: string }) => void;
}

/**
 * Owns only its own input state — no query, no mutation. The page decides
 * what "submitting" means and what happens with the values; mount this under
 * a changing `key` (the page bumps one on a successful apply) to clear the
 * form, since it has no imperative reset handle of its own.
 */
export function LeaveForm({ isSubmitting, onSubmit }: LeaveFormProps): React.JSX.Element {
  const [form, setForm] = useState(EMPTY_FORM);

  const dateOrderInvalid = !!form.startDate && !!form.endDate && form.endDate < form.startDate;
  const canSubmit = !!form.startDate && !!form.endDate && !dateOrderInvalid && !isSubmitting;

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      type: form.type,
      startDate: form.startDate,
      endDate: form.endDate,
      reason: form.reason.trim() || undefined,
    });
  }

  return (
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
        <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={!canSubmit} onClick={submit}>
          {isSubmitting ? 'Submitting…' : 'Submit request'}
        </button>
        {dateOrderInvalid && <span className="sk-state err">The end date must be on or after the start date.</span>}
      </div>
    </div>
  );
}
