'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { QueryError } from '@/components/ui/query-state';
import { Cell, Row, RowList, RowTitle } from '@/components/ui/kit';
import ComponentEditor from './component-editor';
import LeaveSettings from './leave-settings';
import { Card, CardBody, CardHead, EmptyRow, Note, RulesAsAt, TableWrap, Td, Th } from './ui';
import type { AdminAccess, Component, SalarySettings } from './types';

const CALC: Record<string, string> = {
  FIXED: 'A fixed amount', PCT_OF_BASIC: 'A share of Basic', PCT_OF_GROSS: 'A share of gross', BALANCE: 'Whatever is left',
};

/**
 * SETTINGS — the country, the state, the parts a salary is made of, and who
 * may see any of it.
 *
 * The country is frozen once a month has been locked: changing it would
 * invalidate every figure already filed, and a screen that lets an admin do
 * that quietly is a screen that will one day cost a school a penalty.
 */
export default function SettingsTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState('IN');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [editing, setEditing] = useState<Component | null>(null);

  const settings = useQuery({ queryKey: ['salary-settings'], enabled: !!host, queryFn: () => api.get<SalarySettings>('/payroll/settings') });
  const components = useQuery({ queryKey: ['salary-components'], enabled: !!host, queryFn: () => api.get<Component[]>('/payroll/components') });
  const access = useQuery({ queryKey: ['salary-access'], enabled: !!host, queryFn: () => api.get<AdminAccess[]>('/payroll/access') });

  useEffect(() => {
    if (settings.data) { setRegion(settings.data.region ?? ''); setCountry(settings.data.countryCode); }
  }, [settings.data]);

  async function save() {
    setSaving(true); setError(null); setOk(null);
    try {
      await api.post('/payroll/settings', { countryCode: country, region: region || undefined });
      await qc.invalidateQueries({ queryKey: ['salary-settings'] });
      setOk('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally { setSaving(false); }
  }

  async function grant(userId: string, canSeeSalary: boolean) {
    setError(null);
    try {
      await api.post('/payroll/access', { userId, canSeeSalary });
      await qc.invalidateQueries({ queryKey: ['salary-access'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change that.');
    }
  }

  const s = settings.data;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHead><h3>Where this school is</h3></CardHead>
        <CardBody className="grid gap-3">
          {settings.isError ? <QueryError error={settings.error} onRetry={settings.refetch} className="py-4" /> : null}
          {s ? (
            <>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
                <label className="grid gap-1">
                  <span className="sk-lab">Country</span>
                  <select className="sk-input" value={country} onChange={(e) => setCountry(e.target.value)}>
                    {s.countries.map((c) => <option key={c} value={c}>{c === s.countryCode ? s.pack.label : c}</option>)}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="sk-lab">{s.pack.regionLabel}</span>
                  <select className="sk-input" value={region} onChange={(e) => setRegion(e.target.value)}>
                    <option value="">Not set</option>
                    {s.pack.regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="sk-lab">Money</span>
                  <input className="sk-input" value={s.currency} readOnly />
                </label>
              </div>
              <p className="sk-muted" style={{ fontSize: 12 }}>
                The country decides the pay law; the {s.pack.regionLabel.toLowerCase()} decides professional tax, which several states do not levy at all.
                Both are frozen once a month has been locked.
              </p>
              <div className="flex gap-2">
                <button type="button" className="sk-btn sk-press" data-variant="primary" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
              {ok ? <p className="sk-state">{ok}</p> : null}
              {error ? <p className="sk-state err">{error}</p> : null}
              <RulesAsAt asAt={s.pack.rulesAsAt} version={s.pack.version} />
            </>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHead><h3>What a salary is made of</h3></CardHead>
        <CardBody>
          {components.isError ? <QueryError error={components.error} onRetry={components.refetch} className="py-4" /> : null}
          {components.data && components.data.length === 0 ? <EmptyRow>Nothing yet — the standard parts appear the first time you open People.</EmptyRow> : null}
          {components.data && components.data.length > 0 ? (
            <TableWrap minWidth={620}>
              <thead><tr><Th>Part</Th><Th>How it is worked out</Th><Th>Counts as wages</Th><Th>Provident fund</Th><Th /></tr></thead>
              <tbody>
                {components.data.map((c) => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--sk-line)', opacity: c.active ? 1 : 0.55 }}>
                    <Td>
                      {c.name}
                      {c.hint ? <span className="sk-muted" style={{ display: 'block', fontSize: 11 }}>{c.hint}</span> : null}
                      {!c.active ? <span className="sk-muted" style={{ display: 'block', fontSize: 11 }}>Not in use</span> : null}
                    </Td>
                    <Td>{CALC[c.calc]}{c.rateBps != null ? ` — ${c.rateBps / 100}%` : ''}</Td>
                    <Td>{c.isWages ? 'Yes' : 'No'}</Td>
                    <Td>{c.retirementBase ? 'Yes' : 'No'}</Td>
                    <Td right>
                      <button
                        type="button" className="sk-btn" data-size="sm"
                        onClick={() => setEditing(c)}
                        aria-label={`Change ${c.name}`}
                      >
                        Change
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : null}
        </CardBody>
      </Card>

      <LeaveSettings />

      <Card>
        <CardHead><h3>Who may see salaries</h3></CardHead>
        <CardBody className="grid gap-3">
          <Note>
            <p style={{ margin: 0 }}>
              Everywhere else in the console, being an admin is the whole answer. Pay is the one place it is not — so it is granted by name, and every salary screen opened is recorded.
            </p>
          </Note>
          {access.isError ? <QueryError error={access.error} onRetry={access.refetch} className="py-4" /> : null}
          {access.data && access.data.length > 0 ? (
            <RowList columns="1fr auto" label="Who may see salaries">
              {access.data.map((a) => (
                <Row key={a.id} testId={`access-${a.id}`}>
                  <Cell>
                    <RowTitle
                      title={a.name ?? a.email}
                      sub={`${a.job ?? 'Admin'} · ${a.email}`}
                    />
                  </Cell>
                  <Cell align="end">
                    <button
                      type="button" className="sk-btn" data-size="sm"
                      data-variant={a.canSeeSalary ? undefined : 'primary'}
                      onClick={() => void grant(a.id, !a.canSeeSalary)}
                    >
                      {a.canSeeSalary ? 'Take away' : 'Give access'}
                    </button>
                  </Cell>
                </Row>
              ))}
            </RowList>
          ) : null}
          <p className="sk-muted" style={{ fontSize: 12, margin: 0 }}>
            An accounts officer reaches Pay through their job, and still needs to be named here before they can see a
            single figure. Make somebody an accounts officer under Staff.
          </p>
          {error ? <p className="sk-state err">{error}</p> : null}
        </CardBody>
      </Card>

      {editing ? <ComponentEditor component={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
