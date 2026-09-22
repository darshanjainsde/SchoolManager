'use client';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { Card, CardBody, CardHead, EmptyRow, Kpi, Note, TableWrap, Td, Th, rupees, toMinor } from './ui';
import type { Component, Person, PreviewResult, SalarySettings } from './types';

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * PEOPLE — everyone who could be on the payroll, and what each is paid.
 *
 * A structure is never edited: setting pay writes a new row FROM a date, and
 * the run picks whichever row was in force for the month. That is the whole
 * reason a backdated April increment is a computation here rather than a
 * spreadsheet, and the screen says so where the date is typed.
 */
export default function PeopleTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [editing, setEditing] = useState<Person | null>(null);
  const [q, setQ] = useState('');

  const settings = useQuery({ queryKey: ['salary-settings'], enabled: !!host, queryFn: () => api.get<SalarySettings>('/payroll/settings') });
  const people = useQuery({ queryKey: ['salary-people'], enabled: !!host, queryFn: () => api.get<Person[]>('/payroll/people') });

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = people.data ?? [];
    return term ? all.filter((p) => p.name.toLowerCase().includes(term)) : all;
  }, [people.data, q]);
  const onPayroll = (people.data ?? []).filter((p) => p.pay).length;
  const monthly = (people.data ?? []).reduce((a, p) => a + (p.pay?.monthlyGrossMinor ?? 0), 0);

  return (
    <div className="grid gap-4">
      <div className="sk-kpis">
        <Kpi label="On the payroll" value={String(onPayroll)} detail={`of ${people.data?.length ?? 0} people`} tone={onPayroll === 0 ? 'warn' : undefined} />
        <Kpi label="Monthly gross" value={rupees(monthly)} detail="everyone with a structure" />
        <Kpi label="Rule book" value={settings.data?.pack.label ?? '—'} detail={settings.data?.region ? `${settings.data.pack.regionLabel}: ${settings.data.region}` : 'no state set'} tone={settings.data && !settings.data.region ? 'warn' : undefined} />
      </div>

      {settings.data && !settings.data.region ? (
        <Note>
          <p style={{ margin: 0 }}><b>No state is set for this school.</b> Professional tax is a state levy, so nothing can be worked out for it until you set one under Settings.</p>
        </Note>
      ) : null}

      <Card>
        <CardHead>
          <h3>People</h3>
          <input className="sk-input" style={{ maxWidth: '16em' }} placeholder="Find a name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" />
        </CardHead>
        <CardBody>
          {people.isError ? <QueryError error={people.error} onRetry={people.refetch} className="py-4" /> : null}
          {people.isPending ? <EmptyRow>Loading the roll…</EmptyRow> : null}
          {people.data && rows.length === 0 ? <EmptyRow>Nobody matches that.</EmptyRow> : null}
          {rows.length > 0 ? (
            <TableWrap minWidth={640}>
              <thead>
                <tr><Th>Name</Th><Th>Role</Th><Th right>Monthly gross</Th><Th>From</Th><Th>Tax</Th><Th /></tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={`${p.personKind}-${p.id}`} style={{ borderTop: '1px solid var(--sk-line)' }}>
                    <Td>{p.name}</Td>
                    <Td><span style={{ color: 'var(--sk-ink-3)' }}>{p.designation}</span></Td>
                    <Td right>{p.pay ? rupees(p.pay.monthlyGrossMinor) : <span style={{ color: 'var(--sk-ink-3)' }}>not set</span>}</Td>
                    <Td mono>{p.pay ? p.pay.effectiveFrom : '—'}</Td>
                    <Td>{p.pay ? <span className="sk-pill" data-tone={p.pay.taxRegime === 'NEW' ? 'info' : 'neutral'}>{p.pay.taxRegime === 'NEW' ? 'New regime' : 'Old regime'}</span> : '—'}</Td>
                    <Td>
                      <button type="button" className="sk-btn" data-size="sm" onClick={() => setEditing(p)}>
                        {p.pay ? 'Change pay' : 'Set pay'}
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : null}
        </CardBody>
      </Card>

      {editing && settings.data ? (
        <StructureEditor person={editing} settings={settings.data} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function StructureEditor({ person, settings, onClose }: { person: Person; settings: SalarySettings; onClose: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [gross, setGross] = useState(person.pay ? String(person.pay.monthlyGrossMinor / 100) : '');
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso());
  const [conveyance, setConveyance] = useState('1600');
  const [da, setDa] = useState('0');
  const [regime, setRegime] = useState<'NEW' | 'OLD'>(person.pay?.taxRegime ?? settings.pack.defaultRegime);
  const [pfOptIn, setPfOptIn] = useState(person.pay?.pfOptIn ?? true);
  const [pfOnActual, setPfOnActual] = useState(false);
  const [paidThroughVacation, setPaidThroughVacation] = useState(person.pay?.paidThroughVacation ?? true);
  const [contractMonths, setContractMonths] = useState(String(person.pay?.contractMonths ?? 12));
  const [fixedTerm, setFixedTerm] = useState(false);
  const [pan, setPan] = useState('');
  const [uan, setUan] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const components = useQuery({ queryKey: ['salary-components'], enabled: !!host, queryFn: () => api.get<Component[]>('/payroll/components') });
  const grossMinor = toMinor(gross);
  const fixedAmounts = { conveyance: toMinor(conveyance), da: toMinor(da) };

  async function doPreview() {
    setError(null);
    try {
      setPreview(await api.post<PreviewResult>('/payroll/people/preview', { monthlyGrossMinor: grossMinor, fixedAmounts, onISO: effectiveFrom }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not work that out.'); }
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      await api.post('/payroll/people/structure', {
        personKind: person.personKind, personId: person.id, effectiveFrom,
        monthlyGrossMinor: grossMinor, fixedAmounts, taxRegime: regime,
        pfOptIn, pfOnActual, paidThroughVacation,
        contractMonths: Number(contractMonths) || 12, fixedTerm,
        pan: pan || undefined, uan: uan || undefined,
        bankAccount: bankAccount || undefined, bankIfsc: bankIfsc || undefined,
        acceptWageShare: accept,
      });
      await qc.invalidateQueries({ queryKey: ['salary-people'] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHead>
        <h3>{person.pay ? 'Change' : 'Set'} pay — {person.name}</h3>
        <button type="button" className="sk-btn" data-size="sm" onClick={onClose}>Close</button>
      </CardHead>
      <CardBody className="grid gap-3">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}>
          <label className="grid gap-1">
            <span className="sk-lab">Monthly gross (₹)</span>
            <input className="sk-input" inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="40000" />
          </label>
          <label className="grid gap-1">
            <span className="sk-lab">From</span>
            <input className="sk-input" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="sk-lab">Conveyance (₹)</span>
            <input className="sk-input" inputMode="decimal" value={conveyance} onChange={(e) => setConveyance(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="sk-lab">Dearness allowance (₹)</span>
            <input className="sk-input" inputMode="decimal" value={da} onChange={(e) => setDa(e.target.value)} />
          </label>
        </div>
        <p className="sk-muted" style={{ fontSize: 12 }}>
          A change is saved as a NEW row from the date above — the old one stays, so a month already run keeps the pay it was run on.
          Backdate it and the difference becomes arrears you add under Pay run.
        </p>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="sk-btn" onClick={() => void doPreview()} disabled={!grossMinor}>Work out the split</button>
        </div>

        {preview ? (
          <>
            <TableWrap minWidth={420}>
              <thead><tr><Th>Part of the pay</Th><Th right>Amount</Th><Th>Counts as wages</Th></tr></thead>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={l.key} style={{ borderTop: '1px solid var(--sk-line)' }}>
                    <Td>{l.name}</Td>
                    <Td right>{rupees(l.amountMinor)}</Td>
                    <Td>{l.isWages ? 'Yes' : 'No'}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            {preview.wageShare ? (
              <Note>
                <p style={{ margin: 0 }}>
                  <b>Basic is too small a share.</b> Move {rupees(preview.wageShare.shortfallMinor)} a month into Basic, or tick below to record that the school is taking the risk.
                </p>
                <p style={{ margin: 0 }}>{preview.wageShare.note}</p>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                  <span>Save it anyway</span>
                </label>
              </Note>
            ) : null}
          </>
        ) : null}

        <details>
          <summary className="sk-lab" style={{ cursor: 'pointer' }}>Tax, provident fund and bank</summary>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', marginTop: 10 }}>
            <label className="grid gap-1">
              <span className="sk-lab">Tax regime</span>
              <select className="sk-input" value={regime} onChange={(e) => setRegime(e.target.value as 'NEW' | 'OLD')}>
                {settings.pack.regimes.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="sk-lab">PAN</span>
              <input className="sk-input" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} maxLength={10} />
            </label>
            <label className="grid gap-1">
              <span className="sk-lab">Provident fund number (UAN)</span>
              <input className="sk-input" value={uan} onChange={(e) => setUan(e.target.value)} maxLength={12} />
            </label>
            <label className="grid gap-1">
              <span className="sk-lab">Bank account</span>
              <input className="sk-input" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="sk-lab">IFSC</span>
              <input className="sk-input" value={bankIfsc} onChange={(e) => setBankIfsc(e.target.value.toUpperCase())} maxLength={11} />
            </label>
            <label className="grid gap-1">
              <span className="sk-lab">Contract months</span>
              <input className="sk-input" inputMode="numeric" value={contractMonths} onChange={(e) => setContractMonths(e.target.value)} />
            </label>
          </div>
          <div className="grid gap-2" style={{ marginTop: 10 }}>
            <Check checked={pfOptIn} onChange={setPfOptIn} label="In the provident fund" hint="Turn off only for someone genuinely outside it." />
            <Check checked={pfOnActual} onChange={setPfOnActual} label="Contribute on the whole basic" hint="Above the statutory ceiling. A per-person agreement, not a rule." />
            <Check checked={paidThroughVacation} onChange={setPaidThroughVacation} label="Paid through the summer vacation" hint="Off for a contract teacher on a 10- or 11-month term." />
            <Check checked={fixedTerm} onChange={setFixedTerm} label="Fixed-term contract" hint="Gratuity starts after one year for fixed-term staff, not five." />
          </div>
        </details>

        {error ? <p className="sk-state err">{error}</p> : null}
        <div>
          <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={!grossMinor || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save this pay'}
          </button>
        </div>
        {components.isError ? <QueryError error={components.error} onRetry={components.refetch} className="py-2" /> : null}
      </CardBody>
    </Card>
  );
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', minHeight: 32 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
        <span className="sk-muted" style={{ display: 'block', fontSize: 11.5 }}>{hint}</span>
      </span>
    </label>
  );
}
