'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardBody, CardHead, EmptyRow, ListRow, Pill, useDebounced, useDesk, type HouseRow, type PointRow, type RosterStudent } from './ui';

const COLOURS = ['#4F46E5', '#DC2626', '#059669', '#D97706', '#2563EB', '#7C3AED', '#0891B2', '#DB2777'];

/**
 * Houses and the points table. Points are a ledger, so every figure on a
 * tile is the sum of rows anyone can read below it; a correction is a row
 * with a minus sign, never an edit.
 */
export default function HousesTab({ base: _base }: { base: string }) {
  const { api, host, can } = useDesk();
  const qc = useQueryClient();
  const houses = useQuery({ queryKey: ['sports-houses', host], enabled: !!host, queryFn: () => api.get<HouseRow[]>('/sports/houses') });
  const [ledgerHouse, setLedgerHouse] = useState<string>('');
  const ledger = useQuery({ queryKey: ['sports-ledger', host, ledgerHouse], enabled: !!host, queryFn: () => api.get<PointRow[]>(`/sports/houses/ledger${ledgerHouse ? `?houseId=${ledgerHouse}` : ''}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['sports-houses'] }); qc.invalidateQueries({ queryKey: ['sports-ledger'] }); };
  const rows = houses.data ?? [];
  const byId = new Map(rows.map((h) => [h.id, h]));
  const top = Math.max(0, ...rows.map((h) => h.points));

  const [name, setName] = useState('');
  const [color, setColor] = useState(COLOURS[0]);
  const create = useMutation({
    mutationFn: () => api.post('/sports/houses', { name, color }),
    onSuccess: () => { refresh(); setName(''); toast.success('House added.'); },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/sports/houses/${id}`),
    onSuccess: () => { refresh(); toast.success('House removed.'); },
    onError: (e) => toast.error((e as Error).message),
  });
  const [award, setAward] = useState({ houseId: '', points: '', reason: '' });
  const give = useMutation({
    mutationFn: () => api.post(`/sports/houses/${award.houseId}/points`, { points: Number(award.points), reason: award.reason }),
    onSuccess: () => { refresh(); setAward({ ...award, points: '', reason: '' }); toast.success('On the table.'); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="sk-sp-stack">
      <Card>
        <CardHead><h3>House table</h3><p>Placings, match wins and class titles land here on their own; anything else is a row you add with a reason.</p></CardHead>
        <CardBody>
          {houses.isLoading ? <EmptyRow>Opening the table…</EmptyRow> : null}
          {rows.length === 0 && !houses.isLoading ? <EmptyRow>No houses yet. Add them below, then put every child in one — the wizard and the results desk do the rest.</EmptyRow> : null}
          <div className="sk-sp-houses">
            {[...rows].sort((a, b) => b.points - a.points).map((h) => (
              <div key={h.id} className="sk-sp-house" style={{ borderLeftColor: h.color }}>
                <div className="nm"><span className="sk-sp-swatch" style={{ background: h.color }} />{h.name}{h.points === top && top > 0 ? <Pill tone="good">Leading</Pill> : null}</div>
                <div className="pts">{h.points}</div>
                <div className="meta">{h.members} member{h.members === 1 ? '' : 's'}</div>
                {can('HOUSES') && h.points === 0 ? <div><button type="button" className="sk-btn" data-size="sm" disabled={remove.isPending} onClick={() => remove.mutate(h.id)}>Remove</button></div> : null}
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {can('HOUSES') ? (
        <Card>
          <CardHead><h3>Add a house</h3></CardHead>
          <CardBody>
            <div className="sk-sp-fieldrow">
              <label className="sk-sp-field" data-grow=""><span className="sk-lab">Name</span><input className="sk-input" value={name} placeholder="Red" onChange={(e) => setName(e.target.value)} /></label>
              <div className="sk-sp-field"><span className="sk-lab">Colour</span>
                <div className="sk-sp-chips">{COLOURS.map((c) => <button key={c} type="button" className="sk-chip" aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}><span className="sk-sp-swatch" style={{ background: c }} /></button>)}</div>
              </div>
              <button type="button" className="sk-btn" data-variant="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Add house</button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {can('HOUSES') && rows.length ? <Assign houses={rows} onDone={refresh} /> : null}

      {can('HOUSES') && rows.length ? (
        <Card>
          <CardHead><h3>Award or correct points</h3><p>Sports day spirit, a march-past, a correction — a row with a reason. Use a minus to take points away.</p></CardHead>
          <CardBody>
            <div className="sk-sp-fieldrow">
              <label className="sk-sp-field"><span className="sk-lab">House</span><select className="sk-input" value={award.houseId} onChange={(e) => setAward({ ...award, houseId: e.target.value })}><option value="">Choose…</option>{rows.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
              <label className="sk-sp-field"><span className="sk-lab">Points</span><input className="sk-input" inputMode="numeric" value={award.points} style={{ width: '6em' }} onChange={(e) => setAward({ ...award, points: e.target.value })} /></label>
              <label className="sk-sp-field" data-grow=""><span className="sk-lab">Reason</span><input className="sk-input" value={award.reason} placeholder="March-past, best turnout" onChange={(e) => setAward({ ...award, reason: e.target.value })} /></label>
              <button type="button" className="sk-btn" data-variant="primary" disabled={!award.houseId || !Number(award.points) || !award.reason.trim() || give.isPending} onClick={() => give.mutate()}>Add row</button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHead>
          <h3>Ledger</h3>
          <span className="sp" />
          <select className="sk-input" aria-label="House" value={ledgerHouse} onChange={(e) => setLedgerHouse(e.target.value)}><option value="">All houses</option>{rows.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
        </CardHead>
        <CardBody>
          {ledger.data?.length === 0 ? <EmptyRow>No points yet.</EmptyRow> : null}
          {ledger.data?.map((p) => (
            <ListRow key={p.id} primary={<><span className="sk-sp-swatch" style={{ background: byId.get(p.houseId)?.color ?? 'var(--sk-line-2)', display: 'inline-block', marginRight: 8, verticalAlign: 'middle' }} />{byId.get(p.houseId)?.name ?? 'House'}</>} secondary={`${p.reason} · ${new Date(p.createdAt).toISOString().slice(0, 10)}`}>
              <span className="sk-sp-recval" style={{ color: p.points < 0 ? 'var(--sk-bad)' : undefined }}>{p.points > 0 ? `+${p.points}` : p.points}</span>
            </ListRow>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function Assign({ houses, onDone }: { houses: HouseRow[]; onDone: () => void }) {
  const { api, host } = useDesk();
  const qc = useQueryClient();
  const roster = useQuery({ queryKey: ['sports-roster', host], enabled: !!host, staleTime: 60_000, queryFn: () => api.get<RosterStudent[]>('/sports/roster') });
  const [houseId, setHouseId] = useState(houses[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [onlyFree, setOnlyFree] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const query = useDebounced(q).trim().toLowerCase();
  const shown = useMemo(() => (roster.data ?? []).filter((s) => (!onlyFree || !s.houseId) && (!query || s.name.toLowerCase().includes(query))), [roster.data, onlyFree, query]);
  const byStd = new Map<number, RosterStudent[]>();
  for (const s of shown) byStd.set(s.std, [...(byStd.get(s.std) ?? []), s]);
  const set = new Set(picked);
  const assign = useMutation({
    mutationFn: () => api.post<{ moved: number }>('/sports/houses/assign', { houseId: houseId || null, studentIds: picked }),
    onSuccess: (r) => { onDone(); qc.invalidateQueries({ queryKey: ['sports-roster'] }); setPicked([]); toast.success(`${r.moved} moved.`); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card>
      <CardHead><h3>Put students in a house</h3><p>Tick names, pick the house, press Assign. Whole classes at a time is fine.</p></CardHead>
      <CardBody>
        <div className="sk-sp-fieldrow">
          <label className="sk-sp-field"><span className="sk-lab">House</span><select className="sk-input" value={houseId} onChange={(e) => setHouseId(e.target.value)}>{houses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}<option value="">No house (remove)</option></select></label>
          <input className="sk-input" placeholder="Find a name…" aria-label="Find a student" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="sk-sp-actions"><input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> Only children without a house</label>
          <span className="sk-muted">{picked.length} ticked</span>
          <button type="button" className="sk-btn" data-variant="primary" disabled={picked.length === 0 || assign.isPending} onClick={() => assign.mutate()}>Assign</button>
        </div>
        <div className="sk-sp-roster">
          {roster.isLoading ? <EmptyRow>Opening the roll…</EmptyRow> : null}
          {!roster.isLoading && shown.length === 0 ? <EmptyRow>{onlyFree ? 'Everyone is in a house.' : 'Nobody by that name.'}</EmptyRow> : null}
          {[...byStd.entries()].sort((a, b) => a[0] - b[0]).map(([std, kids]) => (
            <div key={std}>
              <div className="sk-sp-classhead">Class {std}<span style={{ flex: 1 }} /><button type="button" className="sk-btn" data-size="sm" onClick={() => setPicked([...new Set([...picked, ...kids.map((k) => k.id)])])}>Tick class {std}</button></div>
              {kids.map((s) => (
                <label key={s.id}>
                  <input type="checkbox" checked={set.has(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} />
                  {s.name}
                  <span className="meta">{s.std} {s.section}{s.houseId ? ` · ${houses.find((h) => h.id === s.houseId)?.name ?? 'a house'}` : ''}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
