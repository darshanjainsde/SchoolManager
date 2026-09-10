'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SPORTS, SPORT_CATEGORIES, formatMark, groupLabel, sportByKey, type MarkScoring } from '@skoolos/types';
import { Card, CardBody, CardHead, EmptyRow, ListRow, Pill, useDebounced, useDesk, type AttemptView, type RecordView, type RosterStudent, type SettingsView } from './ui';
import { groupOptions } from './wizard-model';

const MEASURED = SPORTS.filter((s) => s.scoring.type === 'MARK');
const markScoring = (key: string): MarkScoring | null => { const s = sportByKey(key)?.scoring; return s?.type === 'MARK' ? s : null; };

/**
 * The Book of Records. The standing record per line, its history on demand,
 * the verify queue for anyone with VERIFY, a form to type in the old register,
 * and a form to log a practice claim (ENTER).
 */
export default function RecordsTab({ base: _base }: { base: string }) {
  const { api, host, can } = useDesk();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['sports-settings', host], enabled: !!host, queryFn: () => api.get<SettingsView>('/sports/settings') });
  const book = useQuery({ queryKey: ['sports-records', host], enabled: !!host, queryFn: () => api.get<{ records: RecordView[]; pending: number }>('/sports/records') });
  const attempts = useQuery({ queryKey: ['sports-attempts', host], enabled: !!host && can('VERIFY'), queryFn: () => api.get<AttemptView[]>('/sports/records/attempts') });
  const grouping = settings.data?.grouping ?? 'BANDS';
  const bands = settings.data?.bands ?? [];
  const label = (k: string) => groupLabel(grouping, bands, k);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['sports-records'] }); qc.invalidateQueries({ queryKey: ['sports-attempts'] }); };

  const decide = useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => api.post<{ status: string }>(`/sports/records/attempts/${id}/decide`, { approve, note }),
    onSuccess: (r) => { refresh(); toast.success(r.status === 'APPROVED' ? 'Approved — the record is in the book and the child has been told.' : 'Rejected.'); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="sk-sp-stack">
      {can('VERIFY') ? (
        <Card>
          <CardHead>
            <h3>Waiting for a signature</h3>
            {book.data?.pending ? <Pill tone="amber">{book.data.pending}</Pill> : null}
            <p>Marks that beat the book are queued here — from a meet, a trial or practice. Nothing becomes a record until someone with the right signs it.</p>
          </CardHead>
          <CardBody>
            {attempts.isLoading ? <EmptyRow>Looking…</EmptyRow> : null}
            {attempts.data?.length === 0 ? <EmptyRow>Nothing waiting. A record attempt appears here the moment a heat is ranked or a claim is logged.</EmptyRow> : null}
            {attempts.data?.map((a) => (
              <ListRow key={a.id} primary={<>{a.student.name} <span className="sk-muted">{a.student.classLabel}</span></>} secondary={`${a.sportName} · ${label(a.groupKey)} ${a.category} · ${a.source.toLowerCase()}${a.witnessed ? ', witnessed' : ''}`}>
                <span className="sk-sp-recval">{a.text}</span>
                <button type="button" className="sk-btn" data-size="sm" data-variant="primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: true })}>Approve</button>
                <button type="button" className="sk-btn" data-size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: a.id, approve: false })}>Reject</button>
              </ListRow>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHead>
          <h3>Book of Records</h3>
          <p>One line per sport, group and category. The standing holder is shown; open a line for its history.</p>
        </CardHead>
        <CardBody>
          {book.isLoading ? <EmptyRow>Opening the book…</EmptyRow> : null}
          {book.data?.records.length === 0 ? <EmptyRow>The book is empty. Records arrive from ranked heats, or type the old register in below.</EmptyRow> : null}
          {book.data?.records.map((r) => <RecordLine key={r.id} r={r} label={label} canVerify={can('VERIFY')} onChanged={refresh} />)}
        </CardBody>
      </Card>

      {can('VERIFY') ? <AddRecord grouping={grouping} bands={bands} onDone={refresh} /> : null}
      {can('ENTER') ? <SubmitAttempt grouping={grouping} bands={bands} onDone={refresh} /> : null}
    </div>
  );
}

function RecordLine({ r, label, canVerify, onChanged }: { r: RecordView; label: (k: string) => string; canVerify: boolean; onChanged: () => void }) {
  const { api, host } = useDesk();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [voiding, setVoiding] = useState(false);
  const history = useQuery({
    queryKey: ['sports-record-history', host, r.sportKey, r.groupKey, r.category], enabled: open && !!host,
    queryFn: () => api.get<RecordView[]>(`/sports/records/history?sportKey=${encodeURIComponent(r.sportKey)}&groupKey=${encodeURIComponent(r.groupKey)}&category=${encodeURIComponent(r.category)}`),
  });
  const voidIt = useMutation({
    mutationFn: () => api.post(`/sports/records/${r.id}/void`, { note }),
    onSuccess: () => { setVoiding(false); setNote(''); onChanged(); toast.success('Record withdrawn. The previous holder stands again, if there was one.'); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div>
      <ListRow primary={<>{r.sportName} <span className="sk-muted">{label(r.groupKey)} · {r.category}</span></>} secondary={`${r.holderName} · since ${r.sinceYear}${r.setOn ? ` · set ${r.setOn}` : ''}${r.note ? ` · ${r.note}` : ''}`}>
        <span className="sk-sp-recval">{r.text}</span>
        <button type="button" className="sk-btn" data-size="sm" aria-pressed={open} onClick={() => setOpen(!open)}>History</button>
        {canVerify ? <button type="button" className="sk-btn" data-size="sm" onClick={() => setVoiding(!voiding)}>Void</button> : null}
      </ListRow>
      {voiding ? (
        <div className="sk-sp-fieldrow" style={{ padding: '4px 0 10px' }}>
          <input className="sk-input" placeholder="Why (timing error, wrong category…)" aria-label="Reason for voiding" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: '1 1 240px' }} />
          <button type="button" className="sk-btn" data-tone="bad" data-icon="" disabled={!note.trim() || voidIt.isPending} onClick={() => voidIt.mutate()}>Withdraw this record</button>
        </div>
      ) : null}
      {open ? (
        <div style={{ padding: '0 0 10px 12px' }}>
          {history.isLoading ? <p className="sk-state">Looking back…</p> : null}
          {history.data?.filter((h) => h.id !== r.id).map((h) => (
            <div key={h.id} className="sk-row"><div className="sp"><div className="nm"><span className="sk-sp-recval">{h.text}</span> {h.holderName}</div><div className="meta">{h.sinceYear}{h.untilYear ? `–${h.untilYear}` : ''} · {h.status === 'VOID' ? `void — ${h.note ?? ''}` : h.status.toLowerCase()}</div></div></div>
          ))}
          {history.data && history.data.filter((h) => h.id !== r.id).length === 0 ? <p className="sk-state">No earlier holder on this line.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function AddRecord({ grouping, bands, onDone }: { grouping: 'BANDS' | 'AGE'; bands: SettingsView['bands']; onDone: () => void }) {
  const { api } = useDesk();
  const groups = groupOptions(grouping, bands);
  const [f, setF] = useState({ sportKey: MEASURED[0].key, groupKey: groups[0]?.id ?? '', category: 'Boys', value: '', holderName: '', sinceYear: String(new Date().getUTCFullYear()), untilYear: '', past: false });
  const scoring = markScoring(f.sportKey);
  const add = useMutation({
    mutationFn: () => api.post('/sports/records', {
      sportKey: f.sportKey, groupKey: f.groupKey || groups[0]?.id, category: f.category, value: Number(f.value), holderName: f.holderName, sinceYear: Number(f.sinceYear),
      ...(f.past && f.untilYear ? { untilYear: Number(f.untilYear) } : {}),
    }),
    onSuccess: () => { onDone(); setF({ ...f, value: '', holderName: '' }); toast.success('In the book.'); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card>
      <CardHead><h3>Type in the old register</h3><p>A standing record must beat the book; a past one carries the year it fell.</p></CardHead>
      <CardBody>
        <div className="sk-sp-fieldrow">
          <label className="sk-sp-field"><span className="sk-lab">Sport</span><select className="sk-input" value={f.sportKey} onChange={(e) => setF({ ...f, sportKey: e.target.value })}>{MEASURED.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
          <label className="sk-sp-field"><span className="sk-lab">Group</span><select className="sk-input" value={f.groupKey || groups[0]?.id} onChange={(e) => setF({ ...f, groupKey: e.target.value })}>{groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
          <label className="sk-sp-field"><span className="sk-lab">Category</span><select className="sk-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{SPORT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="sk-sp-field"><span className="sk-lab">{scoring?.label ?? 'Mark'} ({scoring?.unit})</span><input className="sk-input" inputMode="decimal" value={f.value} style={{ width: '8em' }} onChange={(e) => setF({ ...f, value: e.target.value })} /></label>
          <label className="sk-sp-field" data-grow=""><span className="sk-lab">Holder</span><input className="sk-input" value={f.holderName} placeholder="R. Iyer" onChange={(e) => setF({ ...f, holderName: e.target.value })} /></label>
          <label className="sk-sp-field"><span className="sk-lab">Year set</span><input className="sk-input" inputMode="numeric" value={f.sinceYear} style={{ width: '6em' }} onChange={(e) => setF({ ...f, sinceYear: e.target.value })} /></label>
          <label className="sk-sp-field"><span className="sk-lab">Past record</span><span className="sk-sp-actions"><input type="checkbox" checked={f.past} onChange={(e) => setF({ ...f, past: e.target.checked })} />{f.past ? <input className="sk-input" inputMode="numeric" placeholder="Year it fell" value={f.untilYear} style={{ width: '8em' }} onChange={(e) => setF({ ...f, untilYear: e.target.value })} /> : null}</span></label>
          <button type="button" className="sk-btn" data-variant="primary" disabled={!f.value || !f.holderName.trim() || add.isPending} onClick={() => add.mutate()}>Add to the book</button>
        </div>
        {scoring && f.value ? <p className="sk-muted">Reads as {formatMark(scoring, Number(f.value) || 0)}.</p> : null}
      </CardBody>
    </Card>
  );
}

function SubmitAttempt({ grouping, bands, onDone }: { grouping: 'BANDS' | 'AGE'; bands: SettingsView['bands']; onDone: () => void }) {
  const { api, host } = useDesk();
  const groups = groupOptions(grouping, bands);
  const roster = useQuery({ queryKey: ['sports-roster', host], enabled: !!host, staleTime: 60_000, queryFn: () => api.get<RosterStudent[]>('/sports/roster') });
  const [q, setQ] = useState('');
  const query = useDebounced(q).trim().toLowerCase();
  const [f, setF] = useState({ sportKey: MEASURED[0].key, groupKey: groups[0]?.id ?? '', category: 'Boys', studentId: '', value: '', source: 'PRACTICE', witnessed: true });
  const scoring = markScoring(f.sportKey);
  const hits = query ? (roster.data ?? []).filter((s) => s.name.toLowerCase().includes(query)).slice(0, 8) : [];
  const chosen = roster.data?.find((s) => s.id === f.studentId);
  const submit = useMutation({
    mutationFn: () => api.post<{ beatsStanding: boolean }>('/sports/records/attempts', { sportKey: f.sportKey, groupKey: f.groupKey || groups[0]?.id, category: f.category, studentId: f.studentId, value: Number(f.value), source: f.source, witnessed: f.witnessed }),
    onSuccess: (r) => { onDone(); setF({ ...f, value: '', studentId: '' }); setQ(''); toast.success(r.beatsStanding ? 'Logged — it beats the book and is waiting for a signature.' : 'Logged, but it does not beat the standing record.'); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card>
      <CardHead><h3>Log a record claim</h3><p>A mark from practice or a trial. It waits for a signature like a meet mark.</p></CardHead>
      <CardBody>
        <div className="sk-sp-fieldrow">
          <label className="sk-sp-field" data-grow=""><span className="sk-lab">Student</span>
            {chosen ? <span className="sk-sp-actions"><Pill tone="brand">{chosen.name} · {chosen.std} {chosen.section}</Pill><button type="button" className="sk-btn" data-size="sm" onClick={() => setF({ ...f, studentId: '' })}>Change</button></span>
              : <input className="sk-input" placeholder="Type a name…" aria-label="Find a student" value={q} onChange={(e) => setQ(e.target.value)} />}
          </label>
          <label className="sk-sp-field"><span className="sk-lab">Sport</span><select className="sk-input" value={f.sportKey} onChange={(e) => setF({ ...f, sportKey: e.target.value })}>{MEASURED.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}</select></label>
          <label className="sk-sp-field"><span className="sk-lab">Group</span><select className="sk-input" value={f.groupKey || groups[0]?.id} onChange={(e) => setF({ ...f, groupKey: e.target.value })}>{groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</select></label>
          <label className="sk-sp-field"><span className="sk-lab">Category</span><select className="sk-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{SPORT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="sk-sp-field"><span className="sk-lab">{scoring?.label ?? 'Mark'} ({scoring?.unit})</span><input className="sk-input" inputMode="decimal" value={f.value} style={{ width: '8em' }} onChange={(e) => setF({ ...f, value: e.target.value })} /></label>
          <label className="sk-sp-field"><span className="sk-lab">Where</span><select className="sk-input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="PRACTICE">Practice</option><option value="TRIAL">Trial</option></select></label>
          <label className="sk-sp-field"><span className="sk-lab">Witnessed</span><input type="checkbox" checked={f.witnessed} onChange={(e) => setF({ ...f, witnessed: e.target.checked })} /></label>
          <button type="button" className="sk-btn" data-variant="primary" disabled={!f.studentId || !f.value || submit.isPending} onClick={() => submit.mutate()}>Log the claim</button>
        </div>
        {!chosen && hits.length ? <div className="sk-sp-chips">{hits.map((s) => <button key={s.id} type="button" className="sk-chip" onClick={() => setF({ ...f, studentId: s.id })}>{s.name} · {s.std} {s.section}</button>)}</div> : null}
      </CardBody>
    </Card>
  );
}
