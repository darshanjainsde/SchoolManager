'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { PayDetailsCard } from '@/components/pay-details-card';
import { Drawer } from './drawer';
import { Card, CardBody, CardHead, EmptyRow, Note, rupees, toMinor } from './ui';
import type { Grade, Person, PreviewResult, SalarySettings } from './types';

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Holds a value still for a moment, so typing a salary is not one request per digit. */
function useDebounced<T>(value: T, ms = 350): T {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setHeld(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return held;
}

interface Group {
  key: string;
  title: string;
  /** The line under the heading: who is in this group and what it costs. */
  caption: string;
  tone: 'warn' | null;
  people: Person[];
  grade: Grade | null;
}

/**
 * PEOPLE — grouped by the job, with what is blocking you at the top.
 *
 * Two defects this replaces, both mine:
 *
 *  1. The editor rendered AFTER the table, so on a real roster "Set pay"
 *     opened it below the fold and the button looked dead. It is a drawer now.
 *  2. Setting one person's pay asked for gross, conveyance, dearness
 *     allowance, a preview click and a save — thirteen fields, before any
 *     payslip existed. The shipped components already split 50/20/30 and
 *     already satisfy the wage-share rule, so a grade and a figure is enough
 *     and everything else keeps a working default behind "More".
 */
/**
 * How many rows of a group are shown before it offers the rest.
 *
 * On a school's first visit EVERY group is "Not on pay yet" and holds the
 * whole roll — 73 at Raffles — so the page became one endless scroll with the
 * next group, and the summary of what it costs, unreachable below it. Twelve
 * is enough to see what a group holds and short enough that the group AFTER it
 * is still on the screen.
 */
const GROUP_PREVIEW = 12;

export default function PeopleTab({ base }: { base: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Person | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({ queryKey: ['pay-settings'], enabled: !!host, queryFn: () => api.get<SalarySettings>('/payroll/settings') });
  const people = useQuery({ queryKey: ['pay-people'], enabled: !!host, queryFn: () => api.get<Person[]>('/payroll/people') });
  const grades = useQuery({ queryKey: ['pay-grades'], enabled: !!host, queryFn: () => api.get<Grade[]>('/payroll/grades') });

  const groups = useMemo<Group[]>(() => {
    const rows = people.data ?? [];
    const gs = grades.data ?? [];
    const byGrade = new Map<string, Person[]>();
    const notOnPay: Person[] = [];
    const noGrade: Person[] = [];
    for (const p of rows) {
      if (!p.pay) { notOnPay.push(p); continue; }
      if (!p.pay.payGradeId) { noGrade.push(p); continue; }
      const list = byGrade.get(p.pay.payGradeId) ?? [];
      list.push(p);
      byGrade.set(p.pay.payGradeId, list);
    }
    const money = (list: Person[]) => list.reduce((a, p) => a + (p.pay?.monthlyGrossMinor ?? 0), 0);
    const head = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

    const out: Group[] = [];
    // Pinned first: the only group that is a question rather than a fact.
    if (notOnPay.length) {
      out.push({
        key: '__nopay', title: 'Not on pay yet', tone: 'warn', people: notOnPay, grade: null,
        caption: `${head(notOnPay.length)} · nobody can be paid until they have a figure`,
      });
    }
    for (const g of gs) {
      const list = byGrade.get(g.id) ?? [];
      if (!list.length) continue;
      out.push({
        key: g.id, title: g.name, tone: null, people: list, grade: g,
        caption: `${head(list.length)}${g.bandMaxMinor > 0 ? ` · ${rupees(g.bandMinMinor)} – ${rupees(g.bandMaxMinor)}` : ''} · ${rupees(money(list))} a month`,
      });
    }
    if (noGrade.length) {
      out.push({
        key: '__nograde', title: 'No grade', tone: 'warn', people: noGrade, grade: null,
        caption: `${head(noGrade.length)} · ${rupees(money(noGrade))} a month · put them on a grade so a raise can reach them`,
      });
    }
    return out;
  }, [people.data, grades.data]);

  const [justAssigned, setJustAssigned] = useState<{ grade: string; moved: number } | null>(null);
  const assign = useMutation({
    mutationFn: (v: { gradeId: string; effectiveFrom: string; rows: { personKind: 'TEACHER' | 'STAFF'; personId: string; monthlyGrossMinor: number }[] }) =>
      api.post<{ grade: string; moved: number }>('/payroll/grades/assign', v),
    onSuccess: (r: { grade: string; moved: number }) => {
      setBulkOpen(false); setPicked(new Set()); setError(null); setJustAssigned(r);
      void qc.invalidateQueries({ queryKey: ['pay-people'] });
      void qc.invalidateQueries({ queryKey: ['pay-grades'] });
      void qc.invalidateQueries({ queryKey: ['pay-overview'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (people.isError) return <QueryError error={people.error} onRetry={people.refetch} className="py-8" />;

  const rows = people.data ?? [];
  const gradeList = grades.data ?? [];
  const pickedPeople = rows.filter((p) => picked.has(p.id));

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  /** Take or drop a whole group at once — the point of the group heading. */
  const toggleGroup = (g: Group) => {
    const ids = g.people.map((p) => p.id);
    const allOn = ids.every((id) => picked.has(id));
    const next = new Set(picked);
    for (const id of ids) { if (allOn) next.delete(id); else next.add(id); }
    setPicked(next);
  };

  return (
    <div className="sk-paystack">
      {error ? <div className="sk-state" role="alert" style={{ color: 'var(--sk-bad)' }}>{error}</div> : null}

      {justAssigned ? (
        <Note>
          <span>{justAssigned.moved} put on {justAssigned.grade}. The month now knows what it costs.</span>
          <Link className="sk-btn" data-size="sm" href={base} style={{ justifySelf: 'start' }}>Go to This month</Link>
        </Note>
      ) : null}

      {gradeList.length === 0 ? (
        <Note>
          <span>
            There are no grades yet. You can still set one person&rsquo;s pay, but a grade is what makes
            a raise one action instead of one per person.
          </span>
          <a className="sk-btn" data-size="sm" href={`${base}/grades`} style={{ justifySelf: 'start' }}>Make your grades</a>
        </Note>
      ) : null}

      <Card>
        <CardHead>
          <h3>People</h3>
          <span className="flex flex-wrap items-center gap-2">
            <span className="sk-muted">{rows.length} on the roll · {rows.filter((p) => p.pay).length} on pay</span>
            {picked.size > 0 && gradeList.length > 0 ? (
              <button type="button" className="sk-btn sk-press" data-variant="primary" onClick={() => setBulkOpen(true)}>
                Put {picked.size} on a grade
              </button>
            ) : null}
          </span>
        </CardHead>
        <CardBody>
          {people.isLoading ? <p className="sk-state" aria-busy="true">Loading…</p> : null}
          {!people.isLoading && rows.length === 0 ? (
            <EmptyRow>Nobody is on the roll yet. Add teachers and staff first.</EmptyRow>
          ) : null}

          {groups.map((g) => {
            const open = expanded.has(g.key);
            const shown = open ? g.people : g.people.slice(0, GROUP_PREVIEW);
            const hidden = g.people.length - shown.length;
            const allPicked = g.people.length > 0 && g.people.every((p) => picked.has(p.id));
            return (
            <section key={g.key}>
              <div className="sk-paygrouphead">
                <span className="t">{g.title}</span>
                <span className="c">{g.caption}</span>
                {g.tone === 'warn' ? <span className="sk-pill" data-tone="warn">Needs you</span> : null}
                {gradeList.length > 0 && g.people.length > 1 ? (
                  <button type="button" className="sk-btn" data-size="sm" onClick={() => toggleGroup(g)}>
                    {allPicked ? 'Clear' : `Select all ${g.people.length}`}
                  </button>
                ) : null}
              </div>
              <div>
                {shown.map((p) => {
                  const band = g.grade;
                  const out = band && band.bandMaxMinor > 0 && p.pay
                    && (p.pay.monthlyGrossMinor < band.bandMinMinor || p.pay.monthlyGrossMinor > band.bandMaxMinor);
                  return (
                    <div key={p.id} className="sk-payrow">
                      {gradeList.length > 0 ? (
                        <input
                          type="checkbox" className="sk-paycheck"
                          checked={picked.has(p.id)}
                          onChange={() => toggle(p.id)}
                          aria-label={`Select ${p.name}`}
                        />
                      ) : null}
                      <span className="who">
                        <span className="nm">{p.name}</span>
                        <span className="meta">
                          {p.designation ?? (p.personKind === 'TEACHER' ? 'Teacher' : 'Staff')}
                          {p.pay ? ` · from ${p.pay.effectiveFrom}` : ''}
                          {p.pay && !p.pay.hasBank ? <span style={{ color: 'var(--sk-amber-ink)' }}> · no bank account</span> : null}
                          {out ? <span style={{ color: 'var(--sk-amber-ink)' }}> · outside the band</span> : null}
                        </span>
                      </span>
                      {/* No per-row "no pay set" pill: the group heading already says it once,
                          and seventy-two identical pills read as decoration, not a warning. */}
                      {p.pay ? <span className="amt">{rupees(p.pay.monthlyGrossMinor)}</span> : null}
                      <button type="button" className="sk-btn" data-size="sm" onClick={() => { setEditing(p); setError(null); }}>
                        {p.pay ? 'Change' : 'Set pay'}
                      </button>
                    </div>
                  );
                })}
                {hidden > 0 ? (
                  <button type="button" className="sk-paymore" onClick={() => setExpanded(new Set(expanded).add(g.key))}>
                    Show {hidden} more
                  </button>
                ) : null}
                {open && g.people.length > GROUP_PREVIEW ? (
                  <button
                    type="button" className="sk-paymore"
                    onClick={() => { const n = new Set(expanded); n.delete(g.key); setExpanded(n); }}
                  >
                    Show fewer
                  </button>
                ) : null}
              </div>
            </section>
            );
          })}
        </CardBody>
      </Card>

      {editing && settings.data ? (
        <PayDrawer
          person={editing}
          settings={settings.data}
          grades={gradeList}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {bulkOpen ? (
        <BulkAssign
          people={pickedPeople}
          grades={gradeList}
          pending={assign.isPending}
          onClose={() => setBulkOpen(false)}
          onSubmit={(gradeId, effectiveFrom, amounts) => assign.mutate({
            gradeId, effectiveFrom,
            rows: pickedPeople.map((p) => ({
              personKind: p.personKind, personId: p.id,
              monthlyGrossMinor: toMinor(amounts[p.id] ?? ''),
            })),
          })}
        />
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ONE PERSON — a grade, a figure, done.
   ══════════════════════════════════════════════════════════════════════ */

function PayDrawer({ person, settings, grades, onClose }:
{ person: Person; settings: SalarySettings; grades: Grade[]; onClose: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const [gradeId, setGradeId] = useState(person.pay?.payGradeId ?? grades[0]?.id ?? '');
  const [gross, setGross] = useState(person.pay ? String(person.pay.monthlyGrossMinor / 100) : '');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [more, setMore] = useState(false);
  const [regime, setRegime] = useState<'NEW' | 'OLD'>(person.pay?.taxRegime ?? settings.pack.defaultRegime);
  const [pfOptIn, setPfOptIn] = useState(person.pay?.pfOptIn ?? true);
  const [paidThroughVacation, setPaidThroughVacation] = useState(person.pay?.paidThroughVacation ?? true);
  const [contractMonths, setContractMonths] = useState(String(person.pay?.contractMonths ?? 12));
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grossMinor = toMinor(gross);
  const grade = grades.find((g) => g.id === gradeId) ?? null;
  const heldGross = useDebounced(grossMinor);

  // The split, live. A principal who agrees "thirty-five thousand" means
  // take-home; payroll means gross. That gap is the most common argument in a
  // school office and it happens on the 1st, when nothing can be changed —
  // showing it while the figure is being typed moves it to when it can.
  const preview = useQuery({
    queryKey: ['pay-preview', heldGross, gradeId, effectiveFrom],
    enabled: !!host && heldGross > 0,
    queryFn: () => api.post<PreviewResult>('/payroll/people/preview', {
      monthlyGrossMinor: heldGross,
      payGradeId: gradeId || undefined,
      onISO: effectiveFrom,
    }),
  });

  const save = useMutation({
    mutationFn: () => api.post('/payroll/people/structure', {
      personKind: person.personKind, personId: person.id, effectiveFrom,
      monthlyGrossMinor: grossMinor,
      payGradeId: gradeId || undefined,
      taxRegime: regime, pfOptIn, paidThroughVacation,
      contractMonths: Number(contractMonths) || 12,
      // Bank and PAN are deliberately absent: they are saved on their own row-wide
      // path, because they belong to the person and not to this month's pay.
      acceptWageShare: accept,
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pay-people'] });
      void qc.invalidateQueries({ queryKey: ['pay-grades'] });
      void qc.invalidateQueries({ queryKey: ['pay-overview'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const lines = preview.data?.lines ?? [];
  const deductions = lines.filter((l) => l.kind === 'DEDUCTION').reduce((a, l) => a + l.amountMinor, 0);
  const earnings = lines.filter((l) => l.kind === 'EARNING');
  const takeHome = earnings.reduce((a, l) => a + l.amountMinor, 0) - deductions;
  const outOfBand = grade && grade.bandMaxMinor > 0 && grossMinor > 0
    && (grossMinor < grade.bandMinMinor || grossMinor > grade.bandMaxMinor);

  return (
    <Drawer
      title={person.name}
      subtitle={person.designation ?? (person.personKind === 'TEACHER' ? 'Teacher' : 'Staff')}
      onClose={onClose}
      footer={(
        <>
          <span />
          <button
            type="button" className="sk-btn sk-press" data-variant="primary"
            disabled={save.isPending || grossMinor <= 0 || (preview.data?.overshootMinor ?? 0) > 0}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : person.pay ? 'Save' : 'Put on pay'}
          </button>
        </>
      )}
    >
        {grades.length > 0 ? (
          <label className="sk-payfield">
            <span className="lab">Grade</span>
            <select className="sk-input" value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
              <option value="">No grade</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>{g.name}{g.description ? ` — ${g.description}` : ''}</option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="sk-payfield">
          <span className="lab">Monthly pay</span>
          <input
            className="sk-input" inputMode="decimal" value={gross} autoFocus placeholder="35000"
            onChange={(e) => setGross(e.target.value)}
          />
          {grade && grade.bandMaxMinor > 0 ? (
            <span className="hint" style={outOfBand ? { color: 'var(--sk-amber-ink)' } : undefined}>
              {grade.name} band is {rupees(grade.bandMinMinor)} – {rupees(grade.bandMaxMinor)}
              {outOfBand ? ' · this is outside it, which is allowed' : ''}
            </span>
          ) : null}
        </label>

        {grossMinor > 0 && lines.length > 0 ? (
          <div className="sk-paytakehome">
            <span className="lab" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--sk-ink-3)' }}>
              What they will be paid
            </span>
            {earnings.filter((l) => l.amountMinor > 0).map((l) => (
              <div key={l.key} className="r"><span>{l.name}</span><span>{rupees(l.amountMinor)}</span></div>
            ))}
            <div className="r" data-total><span>Takes home about</span><span>{rupees(takeHome)}</span></div>
          </div>
        ) : null}

        {preview.data && preview.data.overshootMinor > 0 ? (
          <Note>
            <span>
              This split adds up to {rupees(preview.data.overshootMinor)} a month MORE than the pay
              above. Lower Basic&rsquo;s share on the grade, or raise the pay — it cannot be saved
              as it is.
            </span>
          </Note>
        ) : null}

        {preview.data?.wageShare ? (
          <Note>
            <span>{preview.data.wageShare.note}</span>
            <label className="flex items-center gap-2" style={{ fontSize: 12.5 }}>
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <span>Save it anyway and record that the school is taking the risk.</span>
            </label>
          </Note>
        ) : null}

        <label className="sk-payfield">
          <span className="lab">From</span>
          <input className="sk-input" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          <span className="hint">
            Saved as a new row from this date. A month already run keeps the pay it was run on, and
            backdating turns the difference into arrears.
          </span>
        </label>

        <button type="button" className="sk-btn" data-size="sm" style={{ justifySelf: 'start' }} onClick={() => setMore((v) => !v)}>
          {more ? 'Hide the rest' : 'More — tax, provident fund, bank'}
        </button>

        {more ? (
          <div className="grid gap-3">
            <label className="sk-payfield">
              <span className="lab">Tax regime</span>
              <select className="sk-input" value={regime} onChange={(e) => setRegime(e.target.value as 'NEW' | 'OLD')}>
                {settings.pack.regimes.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={pfOptIn} onChange={(e) => setPfOptIn(e.target.checked)} />
              <span>A provident fund member</span>
            </label>
            <label className="flex items-center gap-2" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={paidThroughVacation} onChange={(e) => setPaidThroughVacation(e.target.checked)} />
              <span>Paid through the vacation</span>
            </label>
            {!paidThroughVacation ? (
              <label className="sk-payfield">
                <span className="lab">Months on contract</span>
                <input className="sk-input" inputMode="numeric" value={contractMonths} onChange={(e) => setContractMonths(e.target.value)} />
              </label>
            ) : null}
            {/* Bank and PAN are NOT set here. They belong to the person, not
                to this month's pay, so they are saved on their own — and the
                person can set them themselves from My pay. Editing them beside
                a "from this date" figure would imply a change of pay. */}
            {person.pay ? (
              <PayDetailsCard
                endpoint={`/payroll/people/${person.personKind.toLowerCase()}/${person.id}/details`}
                title="Bank and tax numbers"
                invalidate={[['pay-people'], ['pay-overview']]}
              />
            ) : (
              <p className="sk-muted" style={{ fontSize: 12.5 }}>
                Save their pay first, then their bank and tax numbers can be added here — or by
                the person themselves under My pay.
              </p>
            )}
          </div>
        ) : null}

        {error ? <p className="sk-state" role="alert" style={{ color: 'var(--sk-bad)' }}>{error}</p> : null}
    </Drawer>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   SEVERAL PEOPLE AT ONCE — the "3 people are not on a grade" fix.
   ══════════════════════════════════════════════════════════════════════ */

function BulkAssign({ people, grades, pending, onClose, onSubmit }: {
  people: Person[];
  grades: Grade[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (gradeId: string, effectiveFrom: string, amounts: Record<string, string>) => void;
}) {
  const [gradeId, setGradeId] = useState(grades[0]?.id ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const grade = grades.find((g) => g.id === gradeId) ?? null;
  // Everyone starts at the middle of the band, which is the figure a school
  // would have typed for most of them anyway — so this is usually one edit for
  // the exceptions rather than one entry per person.
  const suggested = grade && grade.bandMaxMinor > 0
    ? String(Math.round((grade.bandMinMinor + grade.bandMaxMinor) / 200))
    : '';
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  useEffect(() => {
    setAmounts(Object.fromEntries(people.map((p) => [
      p.id,
      p.pay ? String(p.pay.monthlyGrossMinor / 100) : suggested,
    ])));
  }, [gradeId, people, suggested]);

  const total = people.reduce((a, p) => a + toMinor(amounts[p.id] ?? ''), 0);
  const ready = !!gradeId && people.every((p) => toMinor(amounts[p.id] ?? '') > 0);

  return (
    <Drawer
      title={`Put ${people.length} ${people.length === 1 ? 'person' : 'people'} on a grade`}
      subtitle={total > 0 ? `${rupees(total)} a month in total` : undefined}
      onClose={onClose}
      footer={(
        <>
          <span />
          <button
            type="button" className="sk-btn sk-press" data-variant="primary"
            disabled={pending || !ready}
            onClick={() => onSubmit(gradeId, effectiveFrom, amounts)}
          >
            {pending ? 'Saving…' : `Put ${people.length} on ${grade?.name ?? 'the grade'}`}
          </button>
        </>
      )}
    >
        <label className="sk-payfield">
          <span className="lab">Grade</span>
          <select className="sk-input" value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}{g.description ? ` — ${g.description}` : ''}</option>)}
          </select>
          {grade && grade.bandMaxMinor > 0 ? (
            <span className="hint">Band {rupees(grade.bandMinMinor)} – {rupees(grade.bandMaxMinor)}. Everyone starts in the middle; change anyone who differs.</span>
          ) : null}
        </label>

        <label className="sk-payfield">
          <span className="lab">From</span>
          <input className="sk-input" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </label>

        <div className="grid gap-2">
          {people.map((p) => (
            <div key={p.id} className="sk-payrow">
              <span className="who">
                <span className="nm">{p.name}</span>
                <span className="meta">{p.designation ?? (p.personKind === 'TEACHER' ? 'Teacher' : 'Staff')}</span>
              </span>
              <input
                className="sk-input" inputMode="decimal" style={{ width: '8em', flex: '0 0 auto' }}
                value={amounts[p.id] ?? ''}
                aria-label={`Monthly pay for ${p.name}`}
                onChange={(e) => setAmounts({ ...amounts, [p.id]: e.target.value })}
              />
            </div>
          ))}
        </div>

    </Drawer>
  );
}
