'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, type LibrarySettingsView } from './../ui';

interface NumRow {
  key: keyof LibrarySettingsView;
  label: string;
  sub: string;
  suffix: string;
  min: number;
}

const NUM_ROWS: NumRow[] = [
  { key: 'hallCapacityClasses', label: 'Hall fits', sub: 'classes at the same time', suffix: 'classes', min: 1 },
  { key: 'studentLoanLimit', label: 'A student may hold', sub: 'books at once', suffix: 'books', min: 1 },
  { key: 'teacherLoanLimit', label: 'A teacher may hold', sub: 'books at once', suffix: 'books', min: 1 },
  { key: 'loanDays', label: 'Loan period', sub: 'due date = issue day + this', suffix: 'days', min: 1 },
  { key: 'finePerDayRupees', label: 'Late fine', sub: 'per day, after the grace days', suffix: '₹/day', min: 0 },
  { key: 'graceDays', label: 'Grace days', sub: 'no fine for this many late days', suffix: 'days', min: 0 },
  { key: 'lostFeeRupees', label: 'Lost book charge', sub: 'flat, per copy', suffix: '₹', min: 0 },
];

export default function LibrarySettingsPage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [draft, setDraft] = useState<LibrarySettingsView | null>(null);

  const settings = useQuery({
    queryKey: ['library-settings', host],
    enabled: !!host,
    queryFn: () => api.get<LibrarySettingsView>('/library/settings'),
  });
  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data);
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: (patch: Partial<LibrarySettingsView>) =>
      api.patch<LibrarySettingsView>('/library/settings', patch),
    onSuccess: (row) => {
      setDraft(row);
      qc.invalidateQueries({ queryKey: ['library-settings'] });
      qc.invalidateQueries({ queryKey: ['library-dashboard'] });
      qc.invalidateQueries({ queryKey: ['library-fines'] });
      toast.success('Saved — applies everywhere, instantly');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!draft) {
    return <p className="py-10 text-center text-sm text-[var(--sk-ink-3)]">Opening settings…</p>;
  }

  function commitNumber(row: NumRow, raw: string) {
    const v = Math.max(row.min, parseInt(raw, 10) || row.min);
    setDraft((d) => (d ? { ...d, [row.key]: v } : d));
    if (v !== settings.data?.[row.key]) save.mutate({ [row.key]: v });
  }

  function toggle(key: 'fineTeachers' | 'dueSoonReminders') {
    const v = !draft![key];
    setDraft((d) => (d ? { ...d, [key]: v } : d));
    save.mutate({ [key]: v });
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h1 className="font-serif text-xl font-semibold" style={{ fontFamily: 'var(--sk-serif)' }}>
          Library settings
        </h1>
        <span className="text-xs text-[var(--sk-ink-3)]">changes apply everywhere, instantly</span>
      </div>

      <Card className="max-w-xl overflow-hidden">
        {NUM_ROWS.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between gap-3 border-b border-[var(--sk-line)] px-4 py-2.5 text-sm last:border-b-0"
          >
            <div>
              <div className="font-medium text-[var(--sk-ink)]">{row.label}</div>
              <div className="text-[11px] text-[var(--sk-ink-3)]">{row.sub}</div>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="number"
                min={row.min}
                value={Number(draft[row.key])}
                aria-label={row.label}
                onChange={(e) => setDraft((d) => (d ? { ...d, [row.key]: e.target.value === '' ? row.min : Number(e.target.value) } : d))}
                onBlur={(e) => commitNumber(row, e.target.value)}
                className="w-20 rounded-lg border border-[var(--sk-line)] bg-[var(--sk-bg-2)] px-2.5 py-1.5 text-right font-mono text-xs font-bold text-[var(--sk-ink)]"
              />
              <span className="w-12 text-[11px] text-[var(--sk-ink-3)]">{row.suffix}</span>
            </label>
          </div>
        ))}

        {(
          [
            ['fineTeachers', 'Fine teachers too', 'off = teachers never see or owe fines'],
            ['dueSoonReminders', 'Due-soon reminders', 'email + app, 3 days before'],
          ] as const
        ).map(([key, label, sub]) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 border-b border-[var(--sk-line)] px-4 py-2.5 text-sm last:border-b-0"
          >
            <div>
              <div className="font-medium text-[var(--sk-ink)]">{label}</div>
              <div className="text-[11px] text-[var(--sk-ink-3)]">{sub}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft[key]}
              aria-label={label}
              onClick={() => toggle(key)}
              className={`relative h-6 w-10 rounded-full transition-colors ${draft[key] ? 'bg-[var(--sk-good)]' : 'bg-[var(--sk-line-2)]'}`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${draft[key] ? 'left-[18px]' : 'left-0.5'}`}
              />
            </button>
          </div>
        ))}
      </Card>

      <p className="mt-3 max-w-xl text-xs text-[var(--sk-ink-3)]">
        The school admin can edit these same rules — this is one shared rulebook, not two.
      </p>
    </div>
  );
}
