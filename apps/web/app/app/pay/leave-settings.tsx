'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { Cell, Field, FieldRow, Row, RowList, RowTitle } from '@/components/ui/kit';
import { Card, CardBody, CardHead, EmptyRow, Note } from './ui';
import type { LeaveMonth, LeaveTypeRow } from './types';

const BASES: { key: LeaveMonth['basis']; label: string; detail: string }[] = [
  { key: 'CALENDAR_DAY', label: 'Every day of the leave', detail: 'A Sunday inside the leave costs the same as a Tuesday. The simplest rule, and the most common.' },
  { key: 'WORKING_DAY', label: 'Only working days', detail: 'Sundays and school holidays inside the leave cost nothing, and use up none of the quota either.' },
  { key: 'WARN_ONLY', label: 'Nothing automatically', detail: 'We still show who has gone over, and by how much. The office decides each one by hand.' },
];

/**
 * LEAVE, AS THE SCHOOL WRITES IT DOWN.
 *
 * Two questions, kept apart because they are answered by different people at
 * different times:
 *
 *  · HOW MANY DAYS each type gives — set once a year, and separately for
 *    teachers and for the rest of the staff. One column would have forced a
 *    teacher's quota onto a driver, or a driver's onto a teacher, and every
 *    school we have asked gives them different numbers.
 *  · WHAT A DAY PAST THAT COSTS — one rule for the whole school, because a
 *    per-person deduction rule is a thing nobody can explain to a person.
 *
 * "Never deducts" is the third column and the important one: maternity is 26
 * weeks by law, and a school that deducted for it would be breaking that law
 * through our arithmetic.
 */
export default function LeaveSettings() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const types = useQuery({
    queryKey: ['leave-types'], enabled: !!host,
    queryFn: () => api.get<LeaveTypeRow[]>('/manage/leave-policy/types'),
  });
  const month = useQuery({
    queryKey: ['pay-leave-policy'], enabled: !!host,
    queryFn: () => api.get<LeaveMonth>('/payroll/leave'),
  });

  async function saveType(id: string, patch: Partial<LeaveTypeRow>) {
    setSavingId(id); setError(null); setOk(null);
    try {
      await api.patch(`/manage/leave-policy/types/${id}`, patch);
      await qc.invalidateQueries({ queryKey: ['leave-types'] });
      setOk('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally { setSavingId(null); }
  }

  async function saveRule(patch: { basis?: LeaveMonth['basis']; countHalfDays?: boolean }) {
    setError(null); setOk(null);
    try {
      await api.post('/payroll/leave/policy', {
        basis: patch.basis ?? month.data?.basis,
        countHalfDays: patch.countHalfDays ?? month.data?.countHalfDays,
      });
      await qc.invalidateQueries({ queryKey: ['pay-leave-policy'] });
      await qc.invalidateQueries({ queryKey: ['pay-leave'] });
      setOk('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    }
  }

  const active = types.data?.filter((t) => t.isActive) ?? [];

  return (
    <>
      <Card>
        <CardHead>
          <h3>How much leave people get</h3>
          <span className="sk-muted">Days a year, per type</span>
        </CardHead>
        <CardBody className="grid gap-3">
          {types.isError ? <QueryError error={types.error} onRetry={types.refetch} className="py-4" /> : null}
          {types.data && active.length === 0 ? (
            <EmptyRow>No leave types yet. They appear the first time somebody opens Leave in the console.</EmptyRow>
          ) : null}

          {active.length > 0 ? (
            <RowList columns="1fr 7rem 7rem" label="Leave types">
              {active.map((t) => (
                <Row key={t.id} testId={`leave-type-${t.id}`}>
                  <Cell>
                    <RowTitle
                      title={t.name}
                      sub={t.neverDeduct
                        ? 'Never costs pay'
                        : t.isPaid ? 'Paid — costs pay only past the quota' : 'Unpaid — always costs pay'}
                    />
                    <label className="flex items-center gap-2" style={{ fontSize: 12, marginTop: 6 }}>
                      <input
                        type="checkbox" className="sk-paycheck"
                        checked={t.neverDeduct}
                        disabled={savingId === t.id}
                        onChange={(e) => void saveType(t.id, { neverDeduct: e.target.checked })}
                      />
                      <span>Never deducts pay, whatever the balance says</span>
                    </label>
                  </Cell>
                  <Cell align="end">
                    <Field id={`ann-t-${t.id}`} label={<>Teachers<span className="sr-only"> — days of {t.name} a year</span></>}>
                      {(p) => (
                        <input
                          {...p} className="sk-input" type="number" min={0} max={366} inputMode="numeric"
                          defaultValue={t.defaultAnnual}
                          disabled={savingId === t.id}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v !== t.defaultAnnual) void saveType(t.id, { defaultAnnual: v });
                          }}
                        />
                      )}
                    </Field>
                  </Cell>
                  <Cell align="end">
                    <Field id={`ann-s-${t.id}`} label={<>Other staff<span className="sr-only"> — days of {t.name} a year</span></>}>
                      {(p) => (
                        <input
                          {...p} className="sk-input" type="number" min={0} max={366} inputMode="numeric"
                          defaultValue={t.defaultAnnualStaff}
                          disabled={savingId === t.id}
                          onBlur={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v !== t.defaultAnnualStaff) void saveType(t.id, { defaultAnnualStaff: v });
                          }}
                        />
                      )}
                    </Field>
                  </Cell>
                </Row>
              ))}
            </RowList>
          ) : null}

          <p className="sk-muted" style={{ fontSize: 12, margin: 0 }}>
            Teachers can also be given a different number one by one, under Leave in the console. These are the
            standing figures — what everybody gets unless somebody says otherwise.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHead>
          <h3>What a day past the quota costs</h3>
          <span className="sk-muted">One rule for the whole school</span>
        </CardHead>
        <CardBody className="grid gap-3">
          {month.isError ? <QueryError error={month.error} onRetry={month.refetch} className="py-4" /> : null}
          {month.data ? (
            <>
              <FieldRow min={240}>
                <Field
                  id="lop-basis"
                  label="Days counted"
                  hint={BASES.find((b) => b.key === month.data.basis)?.detail}
                >
                  {(p) => (
                    <select
                      {...p} className="sk-input"
                      value={month.data.basis}
                      onChange={(e) => void saveRule({ basis: e.target.value as LeaveMonth['basis'] })}
                    >
                      {BASES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
                    </select>
                  )}
                </Field>
              </FieldRow>

              <label className="flex items-center gap-2" style={{ fontSize: 13 }}>
                <input
                  type="checkbox" className="sk-paycheck"
                  checked={month.data.countHalfDays}
                  onChange={(e) => void saveRule({ countHalfDays: e.target.checked })}
                />
                <span>A half day costs half a day of pay</span>
              </label>

              <Note>
                <p style={{ margin: 0 }}>
                  Nothing here deducts anything on its own. Every month, Pay shows who went over and by how much, and
                  somebody presses Charge. A month that is already locked cannot be changed — that correction belongs
                  in the next month.
                </p>
              </Note>
            </>
          ) : null}
          {ok ? <p className="sk-state">{ok}</p> : null}
          {error ? <p className="sk-state err">{error}</p> : null}
        </CardBody>
      </Card>
    </>
  );
}
