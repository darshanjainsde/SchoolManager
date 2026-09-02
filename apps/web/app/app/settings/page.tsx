'use client';
import { useMemo, useState, type CSSProperties, type FocusEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, X, Pencil, Check, Coffee, Utensils } from 'lucide-react';
import type { ClassNoteVisibilityValue } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { EmailSettingsCard } from './email-card';
import { TvCard } from './tv-card';

// ── Types ────────────────────────────────────────────────────────────────────

interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
}

type PeriodKind = 'CLASS' | 'BREAK';

interface Period {
  id: string;
  label: string;
  order: number;
  startTime: string;
  endTime: string;
  kind: PeriodKind;
}

/** 1 = Monday … 7 = Sunday, matching `School.workingDays` in the schema. */
const DAYS_OF_WEEK: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `"HH:MM"` + minutes → `"HH:MM"`, wrapping past midnight. */
function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (((h * 60 + m + minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Themed inputs: no dedicated CSS class, styled inline, with a brand-colored
// focus ring applied directly to the DOM node on focus/blur.
const fieldStyle: CSSProperties = {
  display: 'block',
  border: '1px solid var(--sk-line-2)',
  borderRadius: 10,
  padding: '9px 11px',
  background: 'var(--sk-card)',
  color: 'var(--sk-ink)',
  fontSize: 13.5,
  fontFamily: 'inherit',
  transition: 'border-color 0.12s, box-shadow 0.12s',
};

function ringFocus(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-brand)';
  e.currentTarget.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--sk-brand) 18%, transparent)';
}

function ringBlur(e: FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = 'var(--sk-line-2)';
  e.currentTarget.style.boxShadow = 'none';
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Add Academic Year form ────────────────────────────────────────────────────

function AddYearForm({ isSaving, onSave }: { isSaving: boolean; onSave: (data: { name: string; startDate: string; endDate: string; isCurrent: boolean }) => void }) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isCurrent, setIsCurrent] = useState(false);

  const canSave = name.trim() && startDate && endDate;

  function submit() {
    if (!canSave) return;
    onSave({ name: name.trim(), startDate, endDate, isCurrent });
    setName('');
    setStartDate('');
    setEndDate('');
    setIsCurrent(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 160px' }}>
          <label htmlFor="year-name" className="sk-lab">
            Name
          </label>
          <input
            id="year-name"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 2026-2027"
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 140px' }}>
          <label htmlFor="year-start" className="sk-lab">
            Start date
          </label>
          <input
            id="year-start"
            type="date"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 140px' }}>
          <label htmlFor="year-end" className="sk-lab">
            End date
          </label>
          <input
            id="year-end"
            type="date"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--sk-ink-3)' }}>
        <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} />
        Set as current academic year
      </label>
      <div>
        <button className="sk-btn sk-press" data-variant="primary" disabled={isSaving || !canSave} onClick={submit}>
          <Plus className="h-4 w-4" />
          {isSaving ? 'Adding…' : 'Add academic year'}
        </button>
      </div>
    </div>
  );
}

// ── Add Period form ───────────────────────────────────────────────────────────

function AddPeriodForm({
  nextOrder,
  isSaving,
  onSave,
}: {
  nextOrder: number;
  isSaving: boolean;
  onSave: (data: { label: string; order: number; startTime: string; endTime: string }) => void;
}) {
  const [label, setLabel] = useState('');
  const [order, setOrder] = useState(String(nextOrder));
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const orderNum = Number(order);
  const canSave = label.trim() && Number.isInteger(orderNum) && orderNum >= 1 && startTime && endTime;

  function submit() {
    if (!canSave) return;
    onSave({ label: label.trim(), order: orderNum, startTime, endTime });
    setLabel('');
    setOrder(String(nextOrder + 1));
    setStartTime('');
    setEndTime('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '2 1 140px' }}>
          <label htmlFor="period-label" className="sk-lab">
            Label
          </label>
          <input
            id="period-label"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Period 1"
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 70px' }}>
          <label htmlFor="period-order" className="sk-lab">
            Order
          </label>
          <input
            id="period-order"
            type="number"
            min={1}
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={order}
            onChange={(e) => setOrder(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 110px' }}>
          <label htmlFor="period-start" className="sk-lab">
            Start time
          </label>
          <input
            id="period-start"
            type="time"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 110px' }}>
          <label htmlFor="period-end" className="sk-lab">
            End time
          </label>
          <input
            id="period-end"
            type="time"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>
      <div>
        <button className="sk-btn sk-press" data-variant="primary" disabled={isSaving || !canSave} onClick={submit}>
          <Plus className="h-4 w-4" />
          {isSaving ? 'Adding…' : 'Add period'}
        </button>
      </div>
    </div>
  );
}

// ── Working days chips ────────────────────────────────────────────────────────

function WorkingDaysRow({
  workingDays,
  isLoading,
  isSaving,
  onToggle,
}: {
  workingDays: number[];
  isLoading: boolean;
  isSaving: boolean;
  onToggle: (day: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="sk-lab">Working days</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {DAYS_OF_WEEK.map((d) => {
          const active = workingDays.includes(d.value);
          return (
            <button
              key={d.value}
              type="button"
              disabled={isLoading || isSaving}
              aria-pressed={active}
              onClick={() => onToggle(d.value)}
              className="sk-btn sk-press"
              data-variant={active ? 'primary' : undefined}
              style={{ padding: '7px 12px', borderRadius: 999 }}
            >
              {d.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Class note visibility ─────────────────────────────────────────────────────

const CLASS_NOTE_VISIBILITY_OPTIONS: {
  value: ClassNoteVisibilityValue;
  label: string;
  description: string;
}[] = [
  {
    value: 'ALL_TEACHERS',
    label: 'Any teacher of the class',
    description: 'Whoever teaches the class — any subject — can read and add its notes and to-dos.',
  },
  {
    value: 'SUBJECT_TEACHERS',
    label: 'Only the subject’s teachers',
    description:
      'A note is scoped to its subject — only that subject’s teachers (and any substitute covering it that day) can read it. The class teacher can always see every subject for their own class.',
  },
];

function ClassNoteVisibilityCard({
  value,
  isLoading,
  isSaving,
  error,
  onChange,
}: {
  value: ClassNoteVisibilityValue | undefined;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  onChange: (v: ClassNoteVisibilityValue) => void;
}) {
  return (
    <div className="sk-card">
      <div className="sk-card-h">
        <h3>Class notes visibility</h3>
      </div>
      <div className="sk-card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="sk-muted">Who can read a class's notes and to-dos — teachers keep these as a handover log.</p>
        {isLoading && <p className="sk-state">Loading…</p>}
        {error && <p className="sk-state err">{error}</p>}
        {!isLoading && !error && (
          <div role="radiogroup" aria-label="Class notes visibility" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {CLASS_NOTE_VISIBILITY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: isSaving ? 'default' : 'pointer' }}
              >
                <input
                  type="radio"
                  name="class-note-visibility"
                  value={opt.value}
                  checked={value === opt.value}
                  disabled={isSaving}
                  onChange={() => onChange(opt.value)}
                  style={{ marginTop: 3 }}
                />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sk-ink)' }}>{opt.label}</span>
                  <span className="sk-muted" style={{ fontSize: 12.5 }}>{opt.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Quick setup (generate a whole day of periods) ─────────────────────────────

function QuickSetupForm({
  hasExistingPeriods,
  isGenerating,
  onGenerate,
}: {
  hasExistingPeriods: boolean;
  isGenerating: boolean;
  onGenerate: (data: { count: number; minutes: number; dayStart: string }) => void;
}) {
  const [count, setCount] = useState('8');
  const [minutes, setMinutes] = useState('45');
  const [dayStart, setDayStart] = useState('08:00');

  function submit() {
    const countNum = Number(count);
    const minutesNum = Number(minutes);
    if (!Number.isInteger(countNum) || countNum < 1 || countNum > 20) {
      toast.error('Enter a number of periods between 1 and 20');
      return;
    }
    if (!Number.isInteger(minutesNum) || minutesNum < 1 || minutesNum > 300) {
      toast.error('Enter a valid number of minutes per period');
      return;
    }
    if (!dayStart) {
      toast.error('Pick a start time for the day');
      return;
    }
    if (hasExistingPeriods) {
      const ok = window.confirm(
        `This school already has periods configured. Generate ${countNum} more period(s) on top of the existing schedule?`,
      );
      if (!ok) return;
    }
    onGenerate({ count: countNum, minutes: minutesNum, dayStart });
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        borderRadius: 12,
        background: 'var(--sk-brand-tint)',
      }}
    >
      <span className="sk-lab">Quick setup</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 130px' }}>
          <label htmlFor="qs-count" className="sk-lab">
            Number of periods
          </label>
          <input
            id="qs-count"
            type="number"
            min={1}
            max={20}
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 130px' }}>
          <label htmlFor="qs-minutes" className="sk-lab">
            Minutes each
          </label>
          <input
            id="qs-minutes"
            type="number"
            min={1}
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 130px' }}>
          <label htmlFor="qs-start" className="sk-lab">
            Day starts
          </label>
          <input
            id="qs-start"
            type="time"
            style={fieldStyle}
            onFocus={ringFocus}
            onBlur={ringBlur}
            value={dayStart}
            onChange={(e) => setDayStart(e.target.value)}
          />
        </div>
      </div>
      <div>
        <button className="sk-btn sk-press" data-variant="primary" disabled={isGenerating} onClick={submit}>
          {isGenerating ? 'Generating…' : 'Generate day'}
        </button>
      </div>
    </div>
  );
}

// ── Period row (view + inline edit) ───────────────────────────────────────────

function PeriodRow({
  period,
  justAdded = false,
  isUpdating,
  isDeleting,
  onSave,
  onDelete,
}: {
  period: Period;
  /** True for the one period created in this session; drops it in (`sk-pinin`). */
  justAdded?: boolean;
  isUpdating: boolean;
  isDeleting: boolean;
  onSave: (id: string, data: { label: string; startTime: string; endTime: string; kind: PeriodKind }) => void;
  onDelete: (period: Period) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(period.label);
  const [startTime, setStartTime] = useState(period.startTime);
  const [endTime, setEndTime] = useState(period.endTime);
  const [kind, setKind] = useState<PeriodKind>(period.kind);

  function startEdit() {
    setLabel(period.label);
    setStartTime(period.startTime);
    setEndTime(period.endTime);
    setKind(period.kind);
    setEditing(true);
  }

  function save() {
    if (!label.trim() || !startTime || !endTime) return;
    onSave(period.id, { label: label.trim(), startTime, endTime, kind });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="sk-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '2 1 140px' }}>
            <label htmlFor={`period-edit-label-${period.id}`} className="sk-lab">
              Label
            </label>
            <input
              id={`period-edit-label-${period.id}`}
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 110px' }}>
            <label htmlFor={`period-edit-start-${period.id}`} className="sk-lab">
              Start time
            </label>
            <input
              id={`period-edit-start-${period.id}`}
              type="time"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 110px' }}>
            <label htmlFor={`period-edit-end-${period.id}`} className="sk-lab">
              End time
            </label>
            <input
              id={`period-edit-end-${period.id}`}
              type="time"
              style={fieldStyle}
              onFocus={ringFocus}
              onBlur={ringBlur}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="sk-lab">Kind</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="sk-btn sk-press"
                data-variant={kind === 'CLASS' ? 'primary' : undefined}
                style={{ padding: '9px 12px' }}
                onClick={() => setKind('CLASS')}
              >
                Class
              </button>
              <button
                type="button"
                className="sk-btn sk-press"
                data-variant={kind === 'BREAK' ? 'primary' : undefined}
                style={{ padding: '9px 12px' }}
                onClick={() => setKind('BREAK')}
              >
                Break
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="sk-btn sk-press"
            data-variant="primary"
            disabled={isUpdating || !label.trim() || !startTime || !endTime}
            onClick={save}
          >
            <Check className="h-3.5 w-3.5" />
            Save
          </button>
          <button className="sk-btn sk-press" onClick={() => setEditing(false)}>
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    // `sk-pinin` on the period just added: the bell-time list is order-sorted,
    // so a new period slots in among the existing ones rather than at the end.
    // The drop is what says which one is new. Reduced motion collapses it to
    // the settled row — the list itself is unchanged either way.
    <div className={justAdded ? 'sk-row sk-pinin sk-in' : 'sk-row'}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="nm">{period.label}</div>
        {/* Bell times are compared down the column ("does period 3 end before
            lunch?"), so they take the register's monospace face. */}
        <div className="meta sk-num">
          {period.startTime} – {period.endTime}
        </div>
      </div>
      <span className="sk-pill" data-tone={period.kind === 'BREAK' ? 'warn' : 'info'}>
        {period.kind === 'BREAK' ? 'Break' : 'Class'}
      </span>
      <button
        onClick={startEdit}
        aria-label={`Edit period ${period.label}`}
        className="sk-btn sk-press"
        style={{ padding: '6px 9px' }}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        onClick={() => onDelete(period)}
        disabled={isDeleting}
        aria-label={`Remove period ${period.label}`}
        className="sk-btn sk-press"
        style={{ color: 'var(--sk-bad)', padding: '6px 9px' }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

  // Ids of the academic year / period created in this session, so each can be
  // seen landing in its (order-sorted) list instead of appearing between
  // renders. Presentational only — see `sk-pinin` on the rows below.
  const [justAddedYearId, setJustAddedYearId] = useState<string | null>(null);
  const [justAddedPeriodId, setJustAddedPeriodId] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────
  const yearsQuery = useQuery({
    queryKey: ['mng-years'],
    queryFn: () => api.get<AcademicYear[]>('/manage/years'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const periodsQuery = useQuery({
    queryKey: ['mng-periods'],
    queryFn: () => api.get<Period[]>('/manage/periods'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const workingDaysQuery = useQuery({
    queryKey: ['mng-working-days'],
    queryFn: () => api.get<{ workingDays: number[] }>('/manage/school/working-days'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const classNoteVisibilityQuery = useQuery({
    queryKey: ['mng-class-note-visibility'],
    queryFn: () => api.get<{ classNoteVisibility: ClassNoteVisibilityValue }>('/manage/school/class-note-visibility'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!host,
  });

  const sortedPeriods = useMemo(
    () =>
      [...(periodsQuery.data ?? [])].sort(
        (a, b) => a.startTime.localeCompare(b.startTime) || a.order - b.order,
      ),
    [periodsQuery.data],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addYearMutation = useMutation({
    mutationFn: (body: { name: string; startDate: string; endDate: string; isCurrent: boolean }) =>
      api.post<AcademicYear>('/manage/years', body),
    onSuccess: (created) => {
      setJustAddedYearId(created?.id ?? null);
      void queryClient.invalidateQueries({ queryKey: ['mng-years'] });
      toast.success('Academic year added');
    },
    onError: (err: Error) => toast.error(`Failed to add academic year: ${err.message}`),
  });

  const addPeriodMutation = useMutation({
    mutationFn: (body: { label: string; order: number; startTime: string; endTime: string; kind?: PeriodKind }) =>
      api.post<Period>('/manage/periods', body),
    onSuccess: (created) => {
      setJustAddedPeriodId(created?.id ?? null);
      void queryClient.invalidateQueries({ queryKey: ['mng-periods'] });
      toast.success('Period added');
    },
    onError: (err: Error) => toast.error(`Failed to add period: ${err.message}`),
  });

  const updatePeriodMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { label: string; startTime: string; endTime: string; kind: PeriodKind };
    }) => api.put<Period>(`/manage/periods/${id}`, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-periods'] });
      toast.success('Period updated');
    },
    onError: (err: Error) => toast.error(`Failed to update period: ${err.message}`),
  });

  const deletePeriodMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/periods/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-periods'] });
      toast.success('Period removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete period: ${err.message}`),
  });

  const updateWorkingDaysMutation = useMutation({
    mutationFn: (days: number[]) =>
      api.put<{ workingDays: number[] }>('/manage/school/working-days', { workingDays: days }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-working-days'] });
      toast.success('Working days updated');
    },
    onError: (err: Error) => toast.error(`Failed to update working days: ${err.message}`),
  });

  const updateClassNoteVisibilityMutation = useMutation({
    mutationFn: (classNoteVisibility: ClassNoteVisibilityValue) =>
      api.put<{ classNoteVisibility: ClassNoteVisibilityValue }>('/manage/school/class-note-visibility', {
        classNoteVisibility,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-class-note-visibility'] });
      toast.success('Class notes visibility updated');
    },
    onError: (err: Error) => toast.error(`Failed to update class notes visibility: ${err.message}`),
  });

  const [isGenerating, setIsGenerating] = useState(false);
  const [breakDraft, setBreakDraft] = useState<{ label: string; startTime: string; duration: string } | null>(null);

  // Safe-delete: confirm before firing the destructive mutation.
  function confirmDeletePeriod(period: Period) {
    const ok = window.confirm(`Delete period "${period.label}"? This can’t be undone.`);
    if (ok) deletePeriodMutation.mutate(period.id);
  }

  function toggleWorkingDay(day: number) {
    const current = workingDaysQuery.data?.workingDays ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    updateWorkingDaysMutation.mutate(next);
  }

  // Sequentially POSTs N class periods (P1…PN) starting from the next free
  // `order`, so Quick setup never clobbers whatever periods already exist.
  async function generateDay({ count, minutes, dayStart }: { count: number; minutes: number; dayStart: string }) {
    setIsGenerating(true);
    let order = (sortedPeriods[sortedPeriods.length - 1]?.order ?? 0) + 1;
    let time = dayStart;
    try {
      for (let i = 1; i <= count; i += 1) {
        const startTime = time;
        const endTime = addMinutesToTime(startTime, minutes);
        // eslint-disable-next-line no-await-in-loop -- each period's start time
        // depends on the previous one's end time, so these must run in order.
        await api.post<Period>('/manage/periods', {
          label: `P${i}`,
          order,
          startTime,
          endTime,
          kind: 'CLASS',
        });
        time = endTime;
        order += 1;
      }
      await queryClient.invalidateQueries({ queryKey: ['mng-periods'] });
      toast.success(`Generated ${count} period${count === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(`Failed to generate periods: ${(e as Error).message}`);
    } finally {
      setIsGenerating(false);
    }
  }

  function addBreakLike(defaultLabel: string) {
    // Default the start time to right after the last period, so it lands in place.
    const last = sortedPeriods[sortedPeriods.length - 1];
    setBreakDraft({ label: defaultLabel, startTime: last?.endTime ?? '10:30', duration: defaultLabel === 'Lunch' ? '30' : '15' });
  }

  function saveBreakDraft() {
    if (!breakDraft) return;
    if (!TIME_RE.test(breakDraft.startTime)) {
      toast.error('Enter a valid time in HH:MM (24h) format');
      return;
    }
    const duration = Number(breakDraft.duration);
    if (!Number.isInteger(duration) || duration < 1 || duration > 300) {
      toast.error('Enter a valid duration in minutes');
      return;
    }
    const nextOrder = (sortedPeriods[sortedPeriods.length - 1]?.order ?? 0) + 1;
    addPeriodMutation.mutate(
      {
        label: breakDraft.label,
        order: nextOrder,
        startTime: breakDraft.startTime,
        endTime: addMinutesToTime(breakDraft.startTime, duration),
        kind: 'BREAK',
      },
      { onSuccess: () => setBreakDraft(null) },
    );
  }

  const years = yearsQuery.data ?? [];

  return (
    <>
      {/* Add-break modal (replaces the browser prompt) */}
      {breakDraft && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Add ${breakDraft.label.toLowerCase()}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setBreakDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setBreakDraft(null);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 30, 24, 0.5)',
            padding: 16,
          }}
        >
          <div className="sk-card" style={{ width: '100%', maxWidth: 380 }}>
            <div className="sk-card-h">
              <h3>Add {breakDraft.label.toLowerCase()}</h3>
            </div>
            <div className="sk-card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label className="sk-lab" htmlFor="bk-start">Starts at</label>
                <input
                  id="bk-start"
                  type="time"
                  style={fieldStyle}
                  onFocus={ringFocus}
                  onBlur={ringBlur}
                  value={breakDraft.startTime}
                  autoFocus
                  onChange={(e) => setBreakDraft({ ...breakDraft, startTime: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label className="sk-lab" htmlFor="bk-dur">Duration (minutes)</label>
                <input
                  id="bk-dur"
                  type="number"
                  min={1}
                  max={300}
                  style={fieldStyle}
                  onFocus={ringFocus}
                  onBlur={ringBlur}
                  value={breakDraft.duration}
                  onChange={(e) => setBreakDraft({ ...breakDraft, duration: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                <button
                  className="sk-btn sk-press"
                  data-variant="primary"
                  disabled={addPeriodMutation.isPending}
                  onClick={saveBreakDraft}
                >
                  {addPeriodMutation.isPending ? 'Adding…' : `Add ${breakDraft.label.toLowerCase()}`}
                </button>
                <button className="sk-btn sk-press" onClick={() => setBreakDraft(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Page header */}
      <header className="sk-pagehead">
        <h1>Settings</h1>
        <p>
          Academic years and periods are prerequisites — a class can&rsquo;t be created without an academic
          year, and the timetable can&rsquo;t be built without periods.
        </p>
      </header>

      <div className="sk-grid2">
        {/* ── Academic years ─────────────────────────────────────────────── */}
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Academic years</h3>
          </div>
          <div className="sk-card-b">
            <AddYearForm isSaving={addYearMutation.isPending} onSave={(data) => addYearMutation.mutate(data)} />

            {yearsQuery.isLoading && <p className="sk-state">Loading academic years…</p>}
            {yearsQuery.error && <p className="sk-state err">{(yearsQuery.error as Error).message}</p>}
            {!yearsQuery.isLoading && years.length === 0 && (
              <p className="sk-state">No academic years yet. Add one above.</p>
            )}
            {years.length > 0 && (
              <div>
                {years.map((y) => (
                  // `sk-pinin` on the academic year just added — same gesture,
                  // same reason, as the period list beside it.
                  <div key={y.id} className={y.id === justAddedYearId ? 'sk-row sk-pinin sk-in' : 'sk-row'}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nm">{y.name}</div>
                      <div className="meta sk-num">
                        {fmtDate(y.startDate)} – {fmtDate(y.endDate)}
                      </div>
                    </div>
                    {y.isCurrent && (
                      <span className="sk-pill" data-tone="good">
                        Current
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Periods / bell times ───────────────────────────────────────── */}
        <div className="sk-card">
          <div className="sk-card-h">
            <h3>Periods / bell times</h3>
          </div>
          <div className="sk-card-b">
            <WorkingDaysRow
              workingDays={workingDaysQuery.data?.workingDays ?? []}
              isLoading={workingDaysQuery.isLoading}
              isSaving={updateWorkingDaysMutation.isPending}
              onToggle={toggleWorkingDay}
            />
            {workingDaysQuery.error && (
              <p className="sk-state err">{(workingDaysQuery.error as Error).message}</p>
            )}

            <QuickSetupForm
              hasExistingPeriods={sortedPeriods.length > 0}
              isGenerating={isGenerating}
              onGenerate={generateDay}
            />

            <AddPeriodForm
              nextOrder={(sortedPeriods[sortedPeriods.length - 1]?.order ?? 0) + 1}
              isSaving={addPeriodMutation.isPending}
              onSave={(data) => addPeriodMutation.mutate(data)}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="sk-btn sk-press" onClick={() => addBreakLike('Break')} disabled={addPeriodMutation.isPending}>
                <Coffee className="h-4 w-4" />
                Add break
              </button>
              <button className="sk-btn sk-press" onClick={() => addBreakLike('Lunch')} disabled={addPeriodMutation.isPending}>
                <Utensils className="h-4 w-4" />
                Add lunch
              </button>
            </div>

            {periodsQuery.isLoading && <p className="sk-state">Loading periods…</p>}
            {periodsQuery.error && <p className="sk-state err">{(periodsQuery.error as Error).message}</p>}
            {!periodsQuery.isLoading && sortedPeriods.length === 0 && (
              <p className="sk-state">No periods yet. Use Quick setup, or add one above.</p>
            )}
            {sortedPeriods.length > 0 && (
              <div>
                {sortedPeriods.map((p) => (
                  <PeriodRow
                    key={p.id}
                    period={p}
                    isUpdating={updatePeriodMutation.isPending}
                    isDeleting={deletePeriodMutation.isPending}
                    onSave={(id, data) => updatePeriodMutation.mutate({ id, data })}
                    onDelete={confirmDeletePeriod}
                    justAdded={p.id === justAddedPeriodId}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Email ─────────────────────────────────────────────────────── */}
        <EmailSettingsCard />

        <TvCard />

        {/* ── Class notes visibility ────────────────────────────────────── */}
        <ClassNoteVisibilityCard
          value={classNoteVisibilityQuery.data?.classNoteVisibility}
          isLoading={classNoteVisibilityQuery.isLoading}
          isSaving={updateClassNoteVisibilityMutation.isPending}
          error={classNoteVisibilityQuery.error ? (classNoteVisibilityQuery.error as Error).message : null}
          onChange={(v) => updateClassNoteVisibilityMutation.mutate(v)}
        />
      </div>
    </>
  );
}
