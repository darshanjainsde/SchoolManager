'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import DecideTable from '../decide-table';
import { classLabel, type ClassRow, type PlanView, type RowsResponse } from '../types';

/**
 * Step 3. One closing class at a time: pick it, set what counts (the pass
 * mark and which exams), then decide each child. "Save and next class" walks
 * the list, so a school of twelve classes is twelve saves, not four hundred.
 */
export default function DecideStep({ plan, onNext }: { plan: PlanView; onNext: () => void }) {
  const host = useHost();
  const api = useApi({ hostHeader: host });
  const queryClient = useQueryClient();
  const closing = useQuery<ClassRow[]>({
    queryKey: ['mng-classes', host, plan.fromYearId],
    queryFn: () => api.get(`/manage/classes?academicYearId=${plan.fromYearId}`),
    enabled: !!host,
  });
  const sections = useMemo(() => [...(closing.data ?? []).map((c) => ({ id: c.id, label: classLabel(c) })), { id: 'UNPLACED', label: 'No class (unplaced)' }], [closing.data]);
  const [sectionId, setSectionId] = useState<string | null>(null);
  // Default to the first CLOSING class once the list has loaded — never to
  // "Unplaced", which is always in the list and would otherwise win the race.
  const firstClass = closing.data?.[0]?.id ?? (closing.data ? 'UNPLACED' : null);
  const current = sectionId ?? firstClass;
  useEffect(() => {
    if (!sectionId && firstClass) setSectionId(firstClass);
  }, [sectionId, firstClass]);

  const rowsQuery = useQuery<RowsResponse>({
    queryKey: ['session-rows', host, current, plan.version],
    queryFn: () => api.get(`/manage/sessions/plan/students?sectionId=${current}`),
    enabled: !!host && !!current,
  });

  const [passMark, setPassMark] = useState(String(plan.passMarkPct));
  const settings = useMutation({
    mutationFn: (patch: { passMarkPct?: number; countExamIds?: string[] }) => api.patch('/manage/sessions/plan', patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions', host] });
      void queryClient.invalidateQueries({ queryKey: ['session-rows', host] });
    },
    onError: (err: Error) => toast.error(`Could not save: ${err.message}`),
  });

  const goNext = () => {
    const i = sections.findIndex((s) => s.id === current);
    if (i >= 0 && i < sections.length - 1) setSectionId(sections[i + 1].id);
    else onNext();
  };

  const data = rowsQuery.data;
  const finalGrade = !!data && data.rows.length > 0 && data.rows.every((r) => r.defaultDecision === 'PASS_OUT');
  // The plan keeps one list of counted exam ids across every class; this
  // class's chips edit only its own ids in that list, and at least one stays.
  const toggleExam = (examId: string) => {
    if (!data) return;
    const mine = new Set(data.exams.map((e) => e.id));
    const chosen = new Set(data.exams.filter((e) => e.counted).map((e) => e.id));
    if (chosen.has(examId)) {
      if (chosen.size === 1) return;
      chosen.delete(examId);
    } else chosen.add(examId);
    const others = plan.countExamIds.filter((id) => !mine.has(id));
    settings.mutate({ countExamIds: chosen.size === mine.size ? others : [...others, ...chosen] });
  };

  return (
    <div className="sk-card-b">
      <div className="sk-ses-pickrow">
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          <span className="sk-lab">Class</span>
          <select className="sk-input" aria-label="Class to decide" value={current ?? ''} onChange={(e) => setSectionId(e.target.value)}>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span className="sk-lab">Pass mark</span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="sk-input"
              aria-label="Pass mark percent"
              type="number"
              min={0}
              max={100}
              style={{ width: '5.5em' }}
              value={passMark}
              onChange={(e) => setPassMark(e.target.value)}
              onBlur={() => {
                const n = Math.max(0, Math.min(100, Math.round(Number(passMark) || 0)));
                setPassMark(String(n));
                if (n !== plan.passMarkPct) settings.mutate({ passMarkPct: n });
              }}
            />
            <span className="sk-muted">% — flags a child for review, never decides</span>
          </span>
        </label>
      </div>

      {data && data.exams.length > 0 && (
        <details className="sk-ses-exams">
          <summary className="sk-cel-hint">
            Exams that count: {data.exams.every((e) => e.counted) ? 'all published exams of this class' : `${data.exams.filter((e) => e.counted).length} of ${data.exams.length}`}
          </summary>
          <div className="sk-cel-chips" style={{ marginTop: 8 }}>
            {data.exams.map((e) => (
              <button key={e.id} type="button" className="sk-chip sk-press" aria-pressed={e.counted} disabled={settings.isPending} onClick={() => toggleExam(e.id)}>
                {e.title}
              </button>
            ))}
          </div>
        </details>
      )}

      {rowsQuery.isLoading && <p className="sk-muted">Loading the class…</p>}
      {rowsQuery.isError && <p className="text-sm text-rose-600">Could not load this class: {(rowsQuery.error as Error).message}</p>}
      {data && (
        <>
          {data.rows.some((r) => r.joinedSincePlan) && (
            <div className="sk-notice">
              <p className="nt">Some children joined after this plan was opened</p>
              <p className="nd">They are marked in the list. If they were admitted for {plan.toYear.name} already, they may already sit in a next-year class and will not appear here.</p>
            </div>
          )}
          <DecideTable
            key={current ?? 'none'}
            rows={data.rows}
            targets={data.targets}
            passMarkPct={plan.passMarkPct}
            fromYearName={plan.fromYear.name}
            finalGrade={finalGrade}
            joinedSince={null}
            onSaved={() => {
              void queryClient.invalidateQueries({ queryKey: ['sessions', host] });
              goNext();
            }}
            saveLabel={sections.findIndex((s) => s.id === current) === sections.length - 1 ? 'Save and review' : 'Save and next class'}
          />
        </>
      )}
    </div>
  );
}
