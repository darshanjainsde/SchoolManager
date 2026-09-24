'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmt } from '@skoolos/types';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { Cell, Row, RowList, RowTitle } from '@/components/ui/kit';
import { Card, CardBody, CardHead, EmptyRow, Note, monthName } from './ui';
import type { LeaveMonth } from './types';

const BASIS_WORD: Record<LeaveMonth['basis'], string> = {
  CALENDAR_DAY: 'every day of the leave counts',
  WORKING_DAY: 'only working days count',
  WARN_ONLY: 'nothing is deducted automatically',
};

/**
 * LEAVE THIS MONTH — the one place leave turns into money.
 *
 * It PROPOSES and never writes on its own. Three reasons, all learned from
 * what a school does when it disagrees with a payslip:
 *
 *  · The arithmetic is shown as a sentence per person ("Casual 14 of 12 used
 *    → 2 days over"), because "₹2,600 deducted" is unanswerable and the
 *    sentence is arguable.
 *  · Nothing is applied until somebody presses Apply, so a school that wants
 *    to forgive a day forgives it by not pressing.
 *  · Applying writes an ordinary adjustment, which the payslip, the register
 *    and the bank file already understand.
 *
 * A locked month refuses: the correction belongs in the next month, which is
 * how a payroll stays auditable.
 */
export default function LeavePanel({ year, month }: { year: number; month: number }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['pay-leave', year, month], enabled: !!host,
    queryFn: () => api.get<LeaveMonth>(`/payroll/leave?year=${year}&month=${month}`),
  });

  const apply = useMutation({
    mutationFn: (personIds: string[]) => api.post<{ applied: number }>('/payroll/leave/apply', { year, month, personIds }),
    onSuccess: async (r) => {
      setChosen(new Set());
      setDone(r.applied === 1 ? 'One deduction added to this month.' : `${r.applied} deductions added to this month.`);
      await qc.invalidateQueries({ queryKey: ['pay-leave', year, month] });
      await qc.invalidateQueries({ queryKey: ['pay-overview'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} className="py-4" />;
  if (!q.data) return null;

  const d = q.data;
  const open = d.proposals.filter((p) => !p.applied);
  const applied = d.proposals.filter((p) => p.applied);

  // Nothing to say and nothing to warn about: the card would be a row of
  // reassurance nobody asked for. Leave the page shorter instead.
  if (d.proposals.length === 0 && d.warnings.length === 0) return null;

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChosen(next);
    setDone(null);
  };

  return (
    <Card>
      <CardHead>
        <h3>Leave in {monthName(month)}</h3>
        <span className="sk-muted">{d.daysInMonth} days · {BASIS_WORD[d.basis]}</span>
      </CardHead>
      <CardBody className="grid gap-3">
        {d.warnings.length > 0 ? (
          <Note>
            {d.warnings.map((w) => <p key={w} style={{ margin: 0 }}>{w}</p>)}
          </Note>
        ) : null}

        {open.length === 0 && applied.length === 0 ? (
          <EmptyRow>Nobody has gone past their leave this month.</EmptyRow>
        ) : null}

        {open.length > 0 ? (
          <>
            <RowList columns="1fr auto auto" label="Leave to charge this month">
              {open.map((p) => (
                <Row key={p.personId} testId={`leave-${p.personId}`}>
                  <Cell>
                    <RowTitle
                      title={p.name}
                      sub={p.reasons.join(' · ')}
                      tone={p.clamped ? 'warn' : undefined}
                    />
                  </Cell>
                  <Cell align="end">
                    <RowTitle
                      title={`${fmt(p.lopDays)} ${p.lopDays === 1 ? 'day' : 'days'}`}
                      sub={p.clamped ? 'the whole month' : 'unpaid'}
                    />
                  </Cell>
                  <Cell align="end">
                    <input
                      type="checkbox" className="sk-paycheck"
                      checked={chosen.has(p.personId)}
                      onChange={() => toggle(p.personId)}
                      aria-label={`Charge ${fmt(p.lopDays)} unpaid days to ${p.name}`}
                    />
                  </Cell>
                </Row>
              ))}
            </RowList>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button" className="sk-btn sk-press" data-variant="primary"
                disabled={chosen.size === 0 || apply.isPending || d.locked}
                onClick={() => { setError(null); apply.mutate([...chosen]); }}
              >
                {apply.isPending ? 'Applying…' : chosen.size === 0 ? 'Choose who to charge' : `Charge ${chosen.size} ${chosen.size === 1 ? 'person' : 'people'}`}
              </button>
              {chosen.size > 0 ? (
                <button type="button" className="sk-btn" onClick={() => setChosen(new Set())}>Clear</button>
              ) : null}
              {chosen.size < open.length ? (
                <button type="button" className="sk-btn" onClick={() => setChosen(new Set(open.map((p) => p.personId)))}>
                  Choose all {open.length}
                </button>
              ) : null}
            </div>

            <p className="sk-muted" style={{ fontSize: 12, margin: 0 }}>
              Nothing is deducted until you charge it. Charging adds an ordinary deduction to this month, which you can
              still edit on the person&rsquo;s payslip.
            </p>
          </>
        ) : null}

        {applied.length > 0 ? (
          <RowList columns="1fr auto" label="Already charged">
            {applied.map((p) => (
              <Row key={p.personId}>
                <Cell><RowTitle title={p.name} sub={p.reasons.join(' · ')} /></Cell>
                <Cell align="end"><RowTitle title={`${fmt(p.lopDays)} ${p.lopDays === 1 ? 'day' : 'days'}`} sub="already charged" /></Cell>
              </Row>
            ))}
          </RowList>
        ) : null}

        {d.locked ? (
          <p className="sk-state">This month is locked. A correction belongs in the next month.</p>
        ) : null}
        {done ? <p className="sk-state">{done}</p> : null}
        {error ? <p className="sk-state err">{error}</p> : null}
      </CardBody>
    </Card>
  );
}
