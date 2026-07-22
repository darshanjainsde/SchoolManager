'use client';
import { useMemo, useState, type CSSProperties, type FocusEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

// ── Types ────────────────────────────────────────────────────────────────────

interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent?: boolean;
}

interface Period {
  id: string;
  label: string;
  order: number;
  startTime: string;
  endTime: string;
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
        <button className="sk-btn" data-variant="primary" disabled={isSaving || !canSave} onClick={submit}>
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
        <button className="sk-btn" data-variant="primary" disabled={isSaving || !canSave} onClick={submit}>
          <Plus className="h-4 w-4" />
          {isSaving ? 'Adding…' : 'Add period'}
        </button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();

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

  const sortedPeriods = useMemo(
    () => [...(periodsQuery.data ?? [])].sort((a, b) => a.order - b.order),
    [periodsQuery.data],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────
  const addYearMutation = useMutation({
    mutationFn: (body: { name: string; startDate: string; endDate: string; isCurrent: boolean }) =>
      api.post<AcademicYear>('/manage/years', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-years'] });
      toast.success('Academic year added');
    },
    onError: (err: Error) => toast.error(`Failed to add academic year: ${err.message}`),
  });

  const addPeriodMutation = useMutation({
    mutationFn: (body: { label: string; order: number; startTime: string; endTime: string }) =>
      api.post<Period>('/manage/periods', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-periods'] });
      toast.success('Period added');
    },
    onError: (err: Error) => toast.error(`Failed to add period: ${err.message}`),
  });

  const deletePeriodMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/periods/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-periods'] });
      toast.success('Period removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete period: ${err.message}`),
  });

  // Safe-delete: confirm before firing the destructive mutation.
  function confirmDeletePeriod(period: Period) {
    const ok = window.confirm(`Delete period "${period.label}"? This can’t be undone.`);
    if (ok) deletePeriodMutation.mutate(period.id);
  }

  const years = yearsQuery.data ?? [];

  return (
    <>
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
                  <div key={y.id} className="sk-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nm">{y.name}</div>
                      <div className="meta">
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
            <AddPeriodForm
              nextOrder={(sortedPeriods[sortedPeriods.length - 1]?.order ?? 0) + 1}
              isSaving={addPeriodMutation.isPending}
              onSave={(data) => addPeriodMutation.mutate(data)}
            />

            {periodsQuery.isLoading && <p className="sk-state">Loading periods…</p>}
            {periodsQuery.error && <p className="sk-state err">{(periodsQuery.error as Error).message}</p>}
            {!periodsQuery.isLoading && sortedPeriods.length === 0 && (
              <p className="sk-state">No periods yet. Add one above.</p>
            )}
            {sortedPeriods.length > 0 && (
              <div>
                {sortedPeriods.map((p) => (
                  <div key={p.id} className="sk-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nm">{p.label}</div>
                      <div className="meta">
                        {p.startTime} – {p.endTime}
                      </div>
                    </div>
                    <button
                      onClick={() => confirmDeletePeriod(p)}
                      disabled={deletePeriodMutation.isPending}
                      aria-label={`Remove period ${p.label}`}
                      className="sk-btn"
                      style={{ color: 'var(--sk-bad)', padding: '6px 9px' }}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
