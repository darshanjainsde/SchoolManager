'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { Card, CardBody, CardHead, type LibrarySettingsView } from './ui';

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

const TOGGLES = [
  ['fineTeachers', 'Fine teachers too', 'off = teachers never see or owe fines'],
  ['dueSoonReminders', 'Due-soon reminders', 'email + app, 3 days before'],
] as const;

/**
 * One shared rulebook. The admin and the librarian edit the same rows through
 * the same endpoint, which is what the closing line on the card says out loud
 * — it was the first question every school asked.
 *
 * Each row saves on blur rather than behind a Save button: these are seven
 * independent numbers, not a form, and a half-filled form has no meaning here.
 */
export default function SettingsTab() {
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
    return <p className="sk-state">Opening settings…</p>;
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

  // Seven short rows and two switches: capped so the numbers stay beside their
  // labels instead of stretching the width of the console.
  return (
    <div style={{ maxWidth: 640 }}>
    <Card>
      <CardHead>
        <h3>How the library behaves</h3>
        <p className="sk-muted">
          Changes apply everywhere the moment you leave the box. The school admin edits these same
          rules — one shared rulebook, not two.
        </p>
      </CardHead>
      <CardBody>
        {NUM_ROWS.map((row) => (
          <div className="sk-row" key={row.key}>
            <div className="sp">
              <div className="nm">{row.label}</div>
              <div className="meta">{row.sub}</div>
            </div>
            <input
              className="sk-input"
              type="number"
              min={row.min}
              value={Number(draft[row.key])}
              aria-label={row.label}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, [row.key]: e.target.value === '' ? row.min : Number(e.target.value) } : d))
              }
              onBlur={(e) => commitNumber(row, e.target.value)}
              style={{ width: 78, textAlign: 'right', fontFamily: 'var(--sk-mono)', fontWeight: 700 }}
            />
            <span className="meta" style={{ width: 54 }}>{row.suffix}</span>
          </div>
        ))}

        {TOGGLES.map(([key, label, sub]) => (
          <div className="sk-row" key={key}>
            <div className="sp">
              <div className="nm">{label}</div>
              <div className="meta">{sub}</div>
            </div>
            <button
              className="sk-switch"
              type="button"
              role="switch"
              aria-checked={draft[key]}
              aria-label={label}
              onClick={() => toggle(key)}
            />
          </div>
        ))}
      </CardBody>
    </Card>
    </div>
  );
}
