'use client';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Coffee, Pencil, Plus, Utensils, X } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Cell, Field, FieldRow, Overlay, Row, RowList, RowTitle } from '@/components/ui/kit';
import { SettingsActions, SettingsCard, SettingsSection } from './section';

/**
 * Settings → School year (settings audit, 11 Oct 2026): the calendar classes
 * and the timetable are built on. Academic years, school days, and periods.
 * Lists are aligned tables; adding and editing open in a side panel instead of
 * forms that stood open above every list. Email, WhatsApp, the TV and class
 * notes moved to the Notifications and General tabs.
 */

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

/** Minutes between two "HH:MM" times (wrapping past midnight). */
function minutesBetween(start: string, end: string): number | null {
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (((eh * 60 + em) - (sh * 60 + sm)) % (24 * 60) + 24 * 60) % (24 * 60);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

type Panel =
  | { kind: 'year' }
  | { kind: 'period' }
  | { kind: 'quick' }
  | { kind: 'break'; label: string; startTime: string; duration: string }
  | { kind: 'edit'; period: Period };

export default function SettingsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel | null>(null);

  // Ids of the year / period created in this session, so each can be seen
  // landing in its (order-sorted) list. Presentational only (`sk-pinin`).
  const [justAddedYearId, setJustAddedYearId] = useState<string | null>(null);
  const [justAddedPeriodId, setJustAddedPeriodId] = useState<string | null>(null);

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

  const sortedPeriods = useMemo(
    () => [...(periodsQuery.data ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.order - b.order),
    [periodsQuery.data],
  );
  const nextOrder = (sortedPeriods[sortedPeriods.length - 1]?.order ?? 0) + 1;

  const addYearMutation = useMutation({
    mutationFn: (body: { name: string; startDate: string; endDate: string; isCurrent: boolean }) =>
      api.post<AcademicYear>('/manage/years', body),
    onSuccess: (created) => {
      setJustAddedYearId(created?.id ?? null);
      setPanel(null);
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
      setPanel(null);
      void queryClient.invalidateQueries({ queryKey: ['mng-periods'] });
      toast.success('Period added');
    },
    onError: (err: Error) => toast.error(`Failed to add period: ${err.message}`),
  });

  const updatePeriodMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { label: string; startTime: string; endTime: string; kind: PeriodKind } }) =>
      api.put<Period>(`/manage/periods/${id}`, data),
    onSuccess: () => {
      setPanel(null);
      void queryClient.invalidateQueries({ queryKey: ['mng-periods'] });
      toast.success('Period updated');
    },
    onError: (err: Error) => toast.error(`Failed to update period: ${err.message}`),
  });

  const deletePeriodMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/manage/periods/${id}`),
    onSuccess: () => {
      setPanel(null);
      void queryClient.invalidateQueries({ queryKey: ['mng-periods'] });
      toast.success('Period removed');
    },
    onError: (err: Error) => toast.error(`Failed to delete period: ${err.message}`),
  });

  const updateWorkingDaysMutation = useMutation({
    mutationFn: (days: number[]) => api.put<{ workingDays: number[] }>('/manage/school/working-days', { workingDays: days }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mng-working-days'] });
      toast.success('Working days updated');
    },
    onError: (err: Error) => toast.error(`Failed to update working days: ${err.message}`),
  });

  const [isGenerating, setIsGenerating] = useState(false);

  function confirmDeletePeriod(period: Period) {
    const ok = window.confirm(`Delete period "${period.label}"? This can’t be undone.`);
    if (ok) deletePeriodMutation.mutate(period.id);
  }

  function toggleWorkingDay(day: number) {
    const current = workingDaysQuery.data?.workingDays ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
    updateWorkingDaysMutation.mutate(next);
  }

  // Sequentially POSTs N class periods (P1…PN) from the next free `order`,
  // so Quick setup never clobbers the periods that already exist.
  async function generateDay({ count, minutes, dayStart }: { count: number; minutes: number; dayStart: string }) {
    setIsGenerating(true);
    let order = nextOrder;
    let time = dayStart;
    try {
      for (let i = 1; i <= count; i += 1) {
        const startTime = time;
        const endTime = addMinutesToTime(startTime, minutes);
        // eslint-disable-next-line no-await-in-loop -- each start depends on the previous end.
        await api.post<Period>('/manage/periods', { label: `P${i}`, order, startTime, endTime, kind: 'CLASS' });
        time = endTime;
        order += 1;
      }
      await queryClient.invalidateQueries({ queryKey: ['mng-periods'] });
      setPanel(null);
      toast.success(`Generated ${count} period${count === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(`Failed to generate periods: ${(e as Error).message}`);
    } finally {
      setIsGenerating(false);
    }
  }

  function openBreak(defaultLabel: 'Break' | 'Lunch') {
    const last = sortedPeriods[sortedPeriods.length - 1];
    setPanel({ kind: 'break', label: defaultLabel, startTime: last?.endTime ?? '10:30', duration: defaultLabel === 'Lunch' ? '30' : '15' });
  }

  const years = yearsQuery.data ?? [];
  const workingDays = workingDaysQuery.data?.workingDays ?? [];

  return (
    <div data-testid="school-year-settings">
      <SettingsSection
        title="Academic years"
        hint="A class can't be created without an academic year. One year is the current one."
        testId="years-section"
      >
        <SettingsCard flush>
          {yearsQuery.isLoading ? <p className="sk-state" style={{ padding: 16 }}>Loading academic years…</p> : null}
          {yearsQuery.error ? <p className="sk-state err" style={{ padding: 16 }}>{(yearsQuery.error as Error).message}</p> : null}
          {!yearsQuery.isLoading && !yearsQuery.error && years.length === 0 ? (
            <p className="sk-state" style={{ padding: 16 }}>No academic years yet. Add the first one.</p>
          ) : null}
          {years.length > 0 ? (
            <RowList columns="minmax(0,1fr) auto" label="Academic years">
              {years.map((y) => (
                <Row key={y.id} className={y.id === justAddedYearId ? 'sk-pinin sk-in' : ''} testId={`year-${y.id}`}>
                  <Cell><RowTitle title={y.name} sub={<span className="sk-num">{fmtDate(y.startDate)} – {fmtDate(y.endDate)}</span>} /></Cell>
                  <Cell align="end">{y.isCurrent ? <span className="sk-pill" data-tone="good">Current</span> : null}</Cell>
                </Row>
              ))}
            </RowList>
          ) : null}
          <SettingsActions>
            <button type="button" className="sk-btn" data-variant="primary" onClick={() => setPanel({ kind: 'year' })}>
              <Plus className="h-4 w-4" /> Add academic year
            </button>
          </SettingsActions>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="School days" hint="The days the timetable runs. Holidays are set on the Holidays page." testId="days-section">
        <SettingsCard>
          <div className="sk-setchips" role="group" aria-label="Working days">
            {DAYS_OF_WEEK.map((d) => {
              const active = workingDays.includes(d.value);
              return (
                <button key={d.value} type="button" className="sk-btn sk-press" aria-pressed={active}
                  data-variant={active ? 'primary' : undefined}
                  disabled={workingDaysQuery.isLoading || updateWorkingDaysMutation.isPending}
                  onClick={() => toggleWorkingDay(d.value)}>
                  {d.label}
                </button>
              );
            })}
          </div>
          {workingDaysQuery.error ? <p className="sk-state err">{(workingDaysQuery.error as Error).message}</p> : null}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Periods and bell times"
        hint="The timetable is built on these. Tap a period to change it."
        testId="periods-section"
      >
        <SettingsCard flush>
          {periodsQuery.isLoading ? <p className="sk-state" style={{ padding: 16 }}>Loading periods…</p> : null}
          {periodsQuery.error ? <p className="sk-state err" style={{ padding: 16 }}>{(periodsQuery.error as Error).message}</p> : null}
          {!periodsQuery.isLoading && !periodsQuery.error && sortedPeriods.length === 0 ? (
            <p className="sk-state" style={{ padding: 16 }}>No periods yet. Use Quick setup to make a whole day at once.</p>
          ) : null}
          {sortedPeriods.length > 0 ? (
            <RowList columns="minmax(0,1fr) auto auto" label="Periods">
              {sortedPeriods.map((p) => {
                const mins = minutesBetween(p.startTime, p.endTime);
                return (
                  <Row key={p.id} className={p.id === justAddedPeriodId ? 'sk-pinin sk-in' : ''} testId={`period-${p.id}`}
                    onClick={() => setPanel({ kind: 'edit', period: p })}>
                    <Cell><RowTitle title={p.label} sub={<span className="sk-num">{p.startTime} – {p.endTime}{mins !== null ? ` · ${mins} min` : ''}</span>} /></Cell>
                    <Cell><span className="sk-pill" data-tone={p.kind === 'BREAK' ? 'warn' : 'info'}>{p.kind === 'BREAK' ? 'Break' : 'Class'}</span></Cell>
                    <Cell align="end"><Pencil className="h-4 w-4" aria-label={`Edit period ${p.label}`} /></Cell>
                  </Row>
                );
              })}
            </RowList>
          ) : null}
          <SettingsActions>
            <button type="button" className="sk-btn sk-press" onClick={() => openBreak('Break')} disabled={addPeriodMutation.isPending}>
              <Coffee className="h-4 w-4" /> Add break
            </button>
            <button type="button" className="sk-btn sk-press" onClick={() => openBreak('Lunch')} disabled={addPeriodMutation.isPending}>
              <Utensils className="h-4 w-4" /> Add lunch
            </button>
            <button type="button" className="sk-btn sk-press" onClick={() => setPanel({ kind: 'period' })}>
              <Plus className="h-4 w-4" /> Add period
            </button>
            <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={() => setPanel({ kind: 'quick' })}>
              Quick setup
            </button>
          </SettingsActions>
        </SettingsCard>
      </SettingsSection>

      {panel?.kind === 'year' ? (
        <AddYearPanel saving={addYearMutation.isPending} onClose={() => setPanel(null)} onSave={(d) => addYearMutation.mutate(d)} />
      ) : null}
      {panel?.kind === 'period' ? (
        <AddPeriodPanel nextOrder={nextOrder} saving={addPeriodMutation.isPending} onClose={() => setPanel(null)} onSave={(d) => addPeriodMutation.mutate(d)} />
      ) : null}
      {panel?.kind === 'quick' ? (
        <QuickSetupPanel hasExisting={sortedPeriods.length > 0} generating={isGenerating} onClose={() => setPanel(null)} onGenerate={generateDay} />
      ) : null}
      {panel?.kind === 'break' ? (
        <BreakPanel
          draft={panel}
          saving={addPeriodMutation.isPending}
          onChange={(d) => setPanel({ ...panel, ...d })}
          onClose={() => setPanel(null)}
          onSave={() => {
            if (!TIME_RE.test(panel.startTime)) { toast.error('Enter a valid time in HH:MM (24h) format'); return; }
            const duration = Number(panel.duration);
            if (!Number.isInteger(duration) || duration < 1 || duration > 300) { toast.error('Enter a valid duration in minutes'); return; }
            addPeriodMutation.mutate({ label: panel.label, order: nextOrder, startTime: panel.startTime, endTime: addMinutesToTime(panel.startTime, duration), kind: 'BREAK' });
          }}
        />
      ) : null}
      {panel?.kind === 'edit' ? (
        <EditPeriodPanel
          period={panel.period}
          saving={updatePeriodMutation.isPending}
          deleting={deletePeriodMutation.isPending}
          onClose={() => setPanel(null)}
          onSave={(data) => updatePeriodMutation.mutate({ id: panel.period.id, data })}
          onDelete={() => confirmDeletePeriod(panel.period)}
        />
      ) : null}
    </div>
  );
}

// ── Panels ─────────────────────────────────────────────────────────────────

function AddYearPanel({ saving, onClose, onSave }: {
  saving: boolean;
  onClose: () => void;
  onSave: (data: { name: string; startDate: string; endDate: string; isCurrent: boolean }) => void;
}) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isCurrent, setIsCurrent] = useState(false);
  const canSave = !!(name.trim() && startDate && endDate);
  return (
    <Overlay title="Add academic year" onClose={onClose}
      footer={<><button type="button" className="sk-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="sk-btn" data-variant="primary" disabled={saving || !canSave}
          onClick={() => canSave && onSave({ name: name.trim(), startDate, endDate, isCurrent })}>
          {saving ? 'Adding…' : 'Add academic year'}
        </button></>}>
      <Field id="year-name" label="Name">
        {(p) => <input {...p} className="sk-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2026-2027" autoFocus />}
      </Field>
      <FieldRow min={150}>
        <Field id="year-start" label="Start date">
          {(p) => <input {...p} className="sk-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
        </Field>
        <Field id="year-end" label="End date">
          {(p) => <input {...p} className="sk-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
        </Field>
      </FieldRow>
      <label className="sk-setline" style={{ justifyContent: 'flex-start', cursor: 'pointer' }}>
        <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} style={{ width: 18, height: 18 }} />
        <span className="txt">Set as the current academic year</span>
      </label>
    </Overlay>
  );
}

function AddPeriodPanel({ nextOrder, saving, onClose, onSave }: {
  nextOrder: number;
  saving: boolean;
  onClose: () => void;
  onSave: (data: { label: string; order: number; startTime: string; endTime: string }) => void;
}) {
  const [label, setLabel] = useState('');
  const [order, setOrder] = useState(String(nextOrder));
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const orderNum = Number(order);
  const canSave = !!(label.trim() && Number.isInteger(orderNum) && orderNum >= 1 && startTime && endTime);
  return (
    <Overlay title="Add period" onClose={onClose}
      footer={<><button type="button" className="sk-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="sk-btn" data-variant="primary" disabled={saving || !canSave}
          onClick={() => canSave && onSave({ label: label.trim(), order: orderNum, startTime, endTime })}>
          {saving ? 'Adding…' : 'Add period'}
        </button></>}>
      <FieldRow min={150}>
        <Field id="period-label" label="Label">
          {(p) => <input {...p} className="sk-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Period 1" autoFocus />}
        </Field>
        <Field id="period-order" label="Order">
          {(p) => <input {...p} className="sk-input" type="number" min={1} value={order} onChange={(e) => setOrder(e.target.value)} />}
        </Field>
      </FieldRow>
      <FieldRow min={150}>
        <Field id="period-start" label="Start time">
          {(p) => <input {...p} className="sk-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
        </Field>
        <Field id="period-end" label="End time">
          {(p) => <input {...p} className="sk-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
        </Field>
      </FieldRow>
    </Overlay>
  );
}

function QuickSetupPanel({ hasExisting, generating, onClose, onGenerate }: {
  hasExisting: boolean;
  generating: boolean;
  onClose: () => void;
  onGenerate: (data: { count: number; minutes: number; dayStart: string }) => void;
}) {
  const [count, setCount] = useState('8');
  const [minutes, setMinutes] = useState('45');
  const [dayStart, setDayStart] = useState('08:00');
  function submit() {
    const countNum = Number(count);
    const minutesNum = Number(minutes);
    if (!Number.isInteger(countNum) || countNum < 1 || countNum > 20) { toast.error('Enter a number of periods between 1 and 20'); return; }
    if (!Number.isInteger(minutesNum) || minutesNum < 1 || minutesNum > 300) { toast.error('Enter a valid number of minutes per period'); return; }
    if (!dayStart) { toast.error('Pick a start time for the day'); return; }
    if (hasExisting) {
      const ok = window.confirm(`This school already has periods configured. Generate ${countNum} more period(s) on top of the existing schedule?`);
      if (!ok) return;
    }
    onGenerate({ count: countNum, minutes: minutesNum, dayStart });
  }
  return (
    <Overlay title="Quick setup" subtitle="Makes a whole day of class periods, back to back. Add breaks after." onClose={onClose}
      footer={<><button type="button" className="sk-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="sk-btn" data-variant="primary" disabled={generating} onClick={submit}>
          {generating ? 'Generating…' : 'Generate day'}
        </button></>}>
      <Field id="qs-count" label="Number of periods">
        {(p) => <input {...p} className="sk-input" type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} />}
      </Field>
      <FieldRow min={150}>
        <Field id="qs-minutes" label="Minutes each">
          {(p) => <input {...p} className="sk-input" type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />}
        </Field>
        <Field id="qs-start" label="Day starts">
          {(p) => <input {...p} className="sk-input" type="time" value={dayStart} onChange={(e) => setDayStart(e.target.value)} />}
        </Field>
      </FieldRow>
    </Overlay>
  );
}

function BreakPanel({ draft, saving, onChange, onClose, onSave }: {
  draft: { label: string; startTime: string; duration: string };
  saving: boolean;
  onChange: (d: Partial<{ startTime: string; duration: string }>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const what = draft.label.toLowerCase();
  return (
    <Overlay title={`Add ${what}`} side="center" onClose={onClose}
      footer={<><button type="button" className="sk-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="sk-btn" data-variant="primary" disabled={saving} onClick={onSave}>
          {saving ? 'Adding…' : `Add ${what}`}
        </button></>}>
      <Field id="bk-start" label="Starts at">
        {(p) => <input {...p} className="sk-input" type="time" value={draft.startTime} autoFocus onChange={(e) => onChange({ startTime: e.target.value })} />}
      </Field>
      <Field id="bk-dur" label="Duration (minutes)">
        {(p) => <input {...p} className="sk-input" type="number" min={1} max={300} value={draft.duration} onChange={(e) => onChange({ duration: e.target.value })} />}
      </Field>
    </Overlay>
  );
}

function EditPeriodPanel({ period, saving, deleting, onClose, onSave, onDelete }: {
  period: Period;
  saving: boolean;
  deleting: boolean;
  onClose: () => void;
  onSave: (data: { label: string; startTime: string; endTime: string; kind: PeriodKind }) => void;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(period.label);
  const [startTime, setStartTime] = useState(period.startTime);
  const [endTime, setEndTime] = useState(period.endTime);
  const [kind, setKind] = useState<PeriodKind>(period.kind);
  const canSave = !!(label.trim() && startTime && endTime);
  return (
    <Overlay title={`Edit ${period.label}`} onClose={onClose}
      footer={<>
        <button type="button" className="sk-btn" data-tone="bad" disabled={deleting} onClick={onDelete} aria-label={`Remove period ${period.label}`}>
          <X className="h-4 w-4" /> Remove
        </button>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="sk-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="sk-btn" data-variant="primary" disabled={saving || !canSave}
            onClick={() => canSave && onSave({ label: label.trim(), startTime, endTime, kind })}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </span>
      </>}>
      <Field id={`period-edit-label-${period.id}`} label="Label">
        {(p) => <input {...p} className="sk-input" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />}
      </Field>
      <FieldRow min={150}>
        <Field id={`period-edit-start-${period.id}`} label="Start time">
          {(p) => <input {...p} className="sk-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />}
        </Field>
        <Field id={`period-edit-end-${period.id}`} label="End time">
          {(p) => <input {...p} className="sk-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />}
        </Field>
      </FieldRow>
      <div className="sk-field">
        <span className="sk-lab">Kind</span>
        <div className="sk-setchips" role="group" aria-label="Kind">
          <button type="button" className="sk-btn" aria-pressed={kind === 'CLASS'} data-variant={kind === 'CLASS' ? 'primary' : undefined} onClick={() => setKind('CLASS')}>Class</button>
          <button type="button" className="sk-btn" aria-pressed={kind === 'BREAK'} data-variant={kind === 'BREAK' ? 'primary' : undefined} onClick={() => setKind('BREAK')}>Break</button>
        </div>
      </div>
    </Overlay>
  );
}
