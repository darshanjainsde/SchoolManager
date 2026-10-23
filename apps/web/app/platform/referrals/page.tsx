'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { OWNER_HOST } from '@/lib/hosts';
import { useAuthStore } from '@/lib/auth-store';
import { Cell, Field, FieldRow, Overlay, Row, RowList, RowTitle } from '@/components/ui/kit';
import { QueryError } from '@/components/ui/query-state';
import { STAGE_LABEL, stageTone, rupees, when, type ReferralStatus } from '@/lib/promoter-session';
import '../../sk-theme.css';

type Tab = 'tasks' | 'promoters' | 'referrals' | 'payouts' | 'settings';
const TABS: { k: Tab; l: string }[] = [{ k: 'tasks', l: 'Tasks' }, { k: 'promoters', l: 'Promoters' }, { k: 'referrals', l: 'Referrals' }, { k: 'payouts', l: 'Payouts' }, { k: 'settings', l: 'Settings' }];

interface Promoter {
  id: string; code: string; name: string; email: string | null; phoneE164: string | null; city: string | null; status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED'; statusReason: string | null;
  who: string | null; expect: string | null; areas: string | null; know: string | null; schoolsInMind: string | null; hasGst: boolean;
  commissionPct: number | null; commissionCapMinor: number | null; commissionNote: string | null; commissionSetAt: string | null;
  payeeName: string | null; panMasked: string | null; bankAccountMasked: string | null; ifsc: string | null; upi: string | null; gstin: string | null; payoutDetailsAt: string | null; kycVerifiedAt: string | null;
  createdAt: string; referred: number; live: number; earnedMinor: number; paidMinor: number; openTasks: string[];
}
interface Referral {
  id: string; schoolName: string; city: string; area: string | null; studentsApprox: number | null; contactName: string; contactRole: string | null; contactPhone: string; contactEmail: string | null; planInterest: string | null; howKnown: string | null; consent: boolean; viaLink: boolean;
  status: ReferralStatus; statusReason: string | null; attributionUntil: string; lapsed: boolean; invoiceMinor: number | null; rewardMinor: number | null; createdAt: string; leadId: string | null;
  promoter: { id: string; name: string; code: string; commissionPct: number | null; commissionCapMinor: number | null };
  payout: { id: string; status: string; netMinor: number; dueOn: string } | null;
  events: { actor: string; fromStatus: ReferralStatus | null; toStatus: ReferralStatus | null; body: string | null; createdAt: string }[];
}
interface Task { id: string; kind: 'COMMISSION' | 'REFERRAL' | 'KYC'; createdAt: string; note: string | null; promoter: Promoter & { pan?: string | null; bankAccount?: string | null }; referral: Referral | null; suggestedPct: number | null; suggestedCapMinor: number; duplicate: { kind: 'referral' | 'lead' | 'school' | 'lapsed'; on?: string } | null; lapsed: boolean }
interface Payout { id: string; grossMinor: number; tdsMinor: number; netMinor: number; dueOn: string; status: 'DUE' | 'PAID' | 'ON_HOLD'; utr: string | null; paidOn: string | null; referral: { id: string; schoolName: string; city: string; invoiceMinor: number | null }; promoter: Promoter & { detailsComplete: boolean; kycVerified: boolean } }
interface Settings { ladder: Record<string, number>; capMinor: number; payoutDays: number; attributionDays: number; tdsPct: number }

const NEXT: Partial<Record<ReferralStatus, ReferralStatus>> = { LOGGED: 'ACCEPTED', ACCEPTED: 'CONTACTED', CONTACTED: 'DEMO_DONE', DEMO_DONE: 'PROPOSAL_SENT', PROPOSAL_SENT: 'WON', WON: 'LIVE' };
const Pill = ({ s }: { s: ReferralStatus }) => <span className="sk-pill" data-tone={stageTone(s)}>{STAGE_LABEL[s]}</span>;
const msg = (e: unknown) => (e as Error)?.message || 'Something went wrong.';

export default function ReferralsPage() {
  const signedIn = useAuthStore((s) => s.status) === 'authed';
  const api = useApi({ audience: 'platform', hostHeader: OWNER_HOST });
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('tasks');
  const invalidate = () => { for (const k of ['owner-ref-tasks', 'owner-ref-promoters', 'owner-ref-referrals', 'owner-ref-payouts', 'owner-overview', 'owner-leads']) void qc.invalidateQueries({ queryKey: [k] }); };

  const tasks = useQuery({ queryKey: ['owner-ref-tasks'], queryFn: () => api.get<Task[]>('/owner/referrals/tasks'), enabled: signedIn });
  const due = useQuery({ queryKey: ['owner-ref-payouts'], queryFn: () => api.get<Payout[]>('/owner/referrals/payouts'), enabled: signedIn });
  const openTasks = tasks.data?.length ?? 0;
  const dueCount = (due.data ?? []).filter((y) => y.status === 'DUE').length;

  return (
    <div>
      <header className="sk-pagehead">
        <h1>Referrals</h1>
        <p>Refer &amp; Earn: everyone who introduces schools, every school they logged, and every rupee owed. Each referral is also a lead in your pipeline.</p>
      </header>
      <nav className="sk-tabs" aria-label="Referral sections">
        {TABS.map((t) => (
          <button key={t.k} type="button" className="sk-tab" data-active={tab === t.k} onClick={() => setTab(t.k)} style={{ background: 'none', border: 0, borderBottom: '2px solid transparent', cursor: 'pointer', font: 'inherit' }}>
            {t.l}{t.k === 'tasks' && openTasks ? <span className="sk-pill" data-tone="warn">{openTasks}</span> : null}{t.k === 'payouts' && dueCount ? <span className="sk-pill" data-tone="warn">{dueCount}</span> : null}
          </button>
        ))}
      </nav>
      {tab === 'tasks' && <Tasks api={api} q={tasks} onDone={invalidate} />}
      {tab === 'promoters' && <Promoters api={api} enabled={signedIn} onDone={invalidate} />}
      {tab === 'referrals' && <ReferralsTab api={api} enabled={signedIn} onDone={invalidate} />}
      {tab === 'payouts' && <Payouts api={api} q={due} onDone={invalidate} />}
      {tab === 'settings' && <SettingsTab api={api} enabled={signedIn} />}
    </div>
  );
}

type Api = ReturnType<typeof useApi>;

// ─── Tasks ──────────────────────────────────────────────────────────────────

function Tasks({ api, q, onDone }: { api: Api; q: ReturnType<typeof useQuery<Task[]>>; onDone: () => void }) {
  if (q.isLoading) return <p className="sk-state">Loading tasks…</p>;
  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} />;
  const list = q.data ?? [];
  if (list.length === 0) return <div className="sk-card"><div className="sk-card-b" style={{ alignItems: 'center', padding: 28 }}><b>Nothing waiting on you.</b><p className="sk-muted" style={{ margin: 0 }}>Commission requests, new referrals and payout details to verify appear here.</p></div></div>;
  return <div style={{ display: 'grid', gap: 12 }}>{list.map((t) => <TaskCard key={t.id} api={api} t={t} onDone={onDone} />)}</div>;
}

function TaskCard({ api, t, onDone }: { api: Api; t: Task; onDone: () => void }) {
  const p = t.promoter;
  const [pct, setPct] = useState(String(t.suggestedPct ?? 10));
  const [cap, setCap] = useState(String(Math.round((p.commissionCapMinor ?? t.suggestedCapMinor) / 100)));
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { toast.success('Done.'); onDone(); },
    onError: (e) => toast.error(msg(e)),
  });
  const QA = ({ rows }: { rows: [string, React.ReactNode][] }) => (
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 13.5, margin: 0 }}>{rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt className="sk-muted">{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd></div>)}</dl>
  );
  return (
    <div className="sk-card">
      <div className="sk-card-b" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <span className="sk-pill" data-tone="warn">{t.kind === 'COMMISSION' ? 'Commission request' : t.kind === 'REFERRAL' ? 'New referral' : 'Payout details to verify'}</span>
            <span className="sk-pill" data-tone="neutral">{when(t.createdAt)}</span>
          </div>
          {t.kind === 'REFERRAL' && t.referral ? (
            <>
              <h3 style={{ margin: '0 0 2px', fontSize: 15.5 }}>{t.referral.schoolName} · {[t.referral.area, t.referral.city].filter(Boolean).join(', ')}</h3>
              <p className="sk-muted" style={{ margin: '0 0 10px' }}>by {p.name} ({p.code}){t.referral.studentsApprox ? ` · about ${t.referral.studentsApprox} students` : ''}{t.referral.planInterest ? ` · ${t.referral.planInterest}` : ''}{t.referral.viaLink ? ' · came through their link' : ''}</p>
              <QA rows={[['Contact', `${t.referral.contactName}${t.referral.contactRole ? `, ${t.referral.contactRole}` : ''} · ${t.referral.contactPhone}${t.referral.contactEmail ? ` · ${t.referral.contactEmail}` : ''}`], ['Consent', t.referral.consent ? 'Declared by the promoter' : <span style={{ color: 'var(--sk-bad)' }}>Not declared</span>], ['How they know them', t.referral.howKnown || '—'], ['Duplicate check', t.lapsed ? <span className="sk-pill" data-tone="warn" key="d">Lapsed: not accepted inside the window</span> : t.duplicate ? <span className="sk-pill" data-tone="bad" key="d">{t.duplicate.kind === 'referral' ? `Another promoter holds this school${t.duplicate.on ? ` since ${when(t.duplicate.on)}` : ''}` : t.duplicate.kind === 'lead' ? 'Already in your lead pipeline' : t.duplicate.kind === 'school' ? 'Already live on Sckools' : 'Held by a lapsed referral'}</span> : <span className="sk-pill" data-tone="good" key="d">No match in referrals, leads or schools</span>]]} />
            </>
          ) : (
            <>
              <h3 style={{ margin: '0 0 2px', fontSize: 15.5 }}>{p.name}{p.city ? ` · ${p.city}` : ''}</h3>
              <p className="sk-muted" style={{ margin: '0 0 10px' }}>{[p.email, p.phoneE164].filter(Boolean).join(' · ')} · joined {when(p.createdAt)} · {p.referred} referral{p.referred === 1 ? '' : 's'} so far</p>
              {t.kind === 'COMMISSION' ? (
                <QA rows={[['Who', p.who || '—'], ['Expects', p.expect ? `${p.expect} schools in six months` : '—'], ['Areas', p.areas || p.city || '—'], ['How they know schools', p.know || '—'], ['Schools in mind', p.schoolsInMind || '—'], ['GST', p.hasGst ? 'Yes' : 'No']]} />
              ) : (
                <QA rows={[['Payee', p.payeeName || '—'], ['PAN', p.pan || '—'], ['Account', p.bankAccount ? `${p.bankAccount}${p.ifsc ? ` · ${p.ifsc}` : ''}` : '—'], ['UPI', p.upi || '—'], ['GSTIN', p.gstin || '—'], ['Note', t.note || '—']]} />
              )}
            </>
          )}
        </div>
        <div style={{ background: 'var(--sk-bg-2)', border: '1px solid var(--sk-line)', borderRadius: 10, padding: 12, display: 'grid', gap: 10, alignContent: 'start' }}>
          {t.kind === 'COMMISSION' && (
            <>
              <p className="sk-muted" style={{ margin: 0, fontSize: 12.5 }}>Suggested from your ladder for “{p.expect ?? '?'}”: <b>{t.suggestedPct ?? 10}%</b>, cap {rupees(t.suggestedCapMinor)}. Change anything.</p>
              <FieldRow min={120}>
                <Field id={`pct-${t.id}`} label="Commission %">{(f) => <input {...f} className="sk-input" type="number" min={1} max={50} value={pct} onChange={(e) => setPct(e.target.value)} />}</Field>
                <Field id={`cap-${t.id}`} label="Cap per school (₹, 0 = none)">{(f) => <input {...f} className="sk-input" type="number" min={0} value={cap} onChange={(e) => setCap(e.target.value)} />}</Field>
              </FieldRow>
              <Field id={`note-${t.id}`} label="Note the promoter sees">{(f) => <textarea {...f} className="sk-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Good network in Kota; 10% to start, reviewed after three live schools." />}</Field>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="sk-btn" data-variant="primary" disabled={run.isPending} onClick={() => run.mutate(() => api.patch(`/owner/referrals/promoters/${p.id}/commission`, { pct: Number(pct), capMinor: Math.round(Number(cap) * 100), note: note.trim() || undefined }))}>Set commission</button>
                <button className="sk-btn" data-icon data-tone="bad" disabled={run.isPending || reason.trim().length < 3} onClick={() => run.mutate(() => api.patch(`/owner/referrals/promoters/${p.id}/status`, { status: 'REMOVED', reason: reason.trim() }))}>Decline account</button>
              </div>
              <input className="sk-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, if declining (the person sees it)" aria-label="Reason for declining" />
            </>
          )}
          {t.kind === 'REFERRAL' && t.referral && (
            <>
              <p className="sk-muted" style={{ margin: 0, fontSize: 12.5 }}>Accepting creates the lead in your pipeline with source <code>referral:{p.code}</code>.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="sk-btn" data-variant="primary" disabled={run.isPending || !!t.duplicate || t.lapsed} title={t.duplicate || t.lapsed ? 'Reject it with the reason shown' : undefined} onClick={() => run.mutate(() => api.post(`/owner/referrals/${t.referral!.id}/accept`, {}))}>Accept</button>
                <button className="sk-btn" data-icon data-tone="bad" disabled={run.isPending || reason.trim().length < 3} onClick={() => run.mutate(() => api.post(`/owner/referrals/${t.referral!.id}/reject`, { reason: reason.trim() }))}>Reject with reason</button>
              </div>
              <input className="sk-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, if rejecting (the promoter sees it)" aria-label="Reason for rejecting" />
            </>
          )}
          {t.kind === 'KYC' && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="sk-btn" data-variant="primary" disabled={run.isPending || !p.payoutDetailsAt} onClick={() => run.mutate(() => api.post(`/owner/referrals/promoters/${p.id}/kyc-verified`, {}))}>{p.payoutDetailsAt ? 'Verified' : 'Waiting for details'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Promoters ──────────────────────────────────────────────────────────────

function Promoters({ api, enabled, onDone }: { api: Api; enabled: boolean; onDone: () => void }) {
  const [q, setQ] = useState(''); const [city, setCity] = useState(''); const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const [rateFor, setRateFor] = useState<Promoter | null>(null);
  const list = useQuery({ queryKey: ['owner-ref-promoters', q, city, status], queryFn: () => api.get<Promoter[]>(`/owner/referrals/promoters?${new URLSearchParams({ ...(q ? { q } : {}), ...(city ? { city } : {}), ...(status ? { status } : {}) })}`), enabled });
  const cities = useMemo(() => [...new Set((list.data ?? []).map((p) => p.city).filter(Boolean))] as string[], [list.data]);
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: () => { toast.success('Done.'); onDone(); void list.refetch(); }, onError: (e) => toast.error(msg(e)) });
  return (
    <>
      <div className="sk-headrow" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input className="sk-input" style={{ width: 240 }} placeholder="Search name, phone, email, code…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search promoters" />
        <select className="sk-input" style={{ width: 'auto' }} value={city} onChange={(e) => setCity(e.target.value)} aria-label="City"><option value="">Any city</option>{cities.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="sk-input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Active and paused</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Paused</option></select>
        <span style={{ flex: 1 }} />
        <button className="sk-btn" data-variant="primary" onClick={() => setAdding(true)}>+ Add a promoter</button>
      </div>
      {list.isLoading ? <p className="sk-state">Loading promoters…</p> : list.isError ? <QueryError error={list.error} onRetry={list.refetch} /> : (
        <div className="sk-card">
          <RowList columns="minmax(0,1.4fr) minmax(0,1fr) auto auto auto auto auto" label="Promoters">
            {(list.data ?? []).map((p) => (
              <Row key={p.id}>
                <Cell><RowTitle title={<>{p.name} {p.status === 'SUSPENDED' && <span className="sk-pill" data-tone="bad">paused</span>}{!p.payoutDetailsAt && <span className="sk-pill" data-tone="warn">no payout details</span>}</>} sub={`${p.code} · ${[p.email, p.phoneE164].filter(Boolean).join(' · ')} · joined ${when(p.createdAt)}`} /></Cell>
                <Cell><RowTitle title={p.city || '—'} sub={`${p.who || '—'}${p.expect ? ` · expects ${p.expect}` : ''}`} /></Cell>
                <Cell>{p.commissionPct ? <RowTitle title={`${p.commissionPct}%`} sub={`cap ${p.commissionCapMinor ? rupees(p.commissionCapMinor) : 'none'}`} /> : <span className="sk-pill" data-tone="warn">not set</span>}</Cell>
                <Cell align="end"><RowTitle title={String(p.referred)} sub="referred" /></Cell>
                <Cell align="end"><RowTitle title={String(p.live)} sub="live" /></Cell>
                <Cell align="end"><RowTitle title={rupees(p.earnedMinor)} sub="earned" /></Cell>
                <Cell>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    <button className="sk-btn" onClick={() => setRateFor(p)}>Set rate</button>
                    {p.status === 'ACTIVE' ? <button className="sk-btn" data-icon data-tone="bad" onClick={() => { const reason = window.prompt(`Pause ${p.name}? Say why; they see it.`); if (reason && reason.trim().length >= 3) run.mutate(() => api.patch(`/owner/referrals/promoters/${p.id}/status`, { status: 'SUSPENDED', reason: reason.trim() })); }}>Pause</button> : <button className="sk-btn" onClick={() => run.mutate(() => api.patch(`/owner/referrals/promoters/${p.id}/status`, { status: 'ACTIVE' }))}>Restore</button>}
                    {p.email && <button className="sk-btn" onClick={() => run.mutate(() => api.post(`/owner/referrals/promoters/${p.id}/login-link`, {}))}>Send login</button>}
                  </div>
                </Cell>
              </Row>
            ))}
            {(list.data ?? []).length === 0 && <p className="sk-muted" style={{ padding: 16, margin: 0 }}>No promoter matches.</p>}
          </RowList>
        </div>
      )}
      {adding && <AddPromoter api={api} onClose={() => setAdding(false)} onDone={() => { setAdding(false); onDone(); void list.refetch(); }} />}
      {rateFor && <SetRate api={api} p={rateFor} onClose={() => setRateFor(null)} onDone={() => { setRateFor(null); onDone(); void list.refetch(); }} />}
    </>
  );
}

function AddPromoter({ api, onClose, onDone }: { api: Api; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', city: '' });
  const [err, setErr] = useState<string | null>(null);
  const run = useMutation({ mutationFn: () => api.post('/owner/referrals/promoters', { name: f.name.trim(), email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, city: f.city.trim() || undefined }), onSuccess: () => { toast.success('Promoter added; they sign in with a code.'); onDone(); }, onError: (e) => setErr(msg(e)) });
  return (
    <Overlay title="Add a promoter" subtitle="For people you recruit in person. They sign in with a one-time code on the email or number you give." onClose={onClose} side="center"
      footer={<>{err ? <span className="sk-state err">{err}</span> : <span />}<button className="sk-btn" onClick={onClose}>Cancel</button><button className="sk-btn" data-variant="primary" disabled={run.isPending || f.name.trim().length < 2 || (!f.email.trim() && !f.phone.trim())} onClick={() => run.mutate()}>Add</button></>}>
      <Field id="ap-name" label="Name">{(p) => <input {...p} className="sk-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />}</Field>
      <FieldRow>
        <Field id="ap-email" label="Email">{(p) => <input {...p} className="sk-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field id="ap-phone" label="WhatsApp number">{(p) => <input {...p} className="sk-input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
      </FieldRow>
      <Field id="ap-city" label="City (optional)">{(p) => <input {...p} className="sk-input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}</Field>
    </Overlay>
  );
}

function SetRate({ api, p, onClose, onDone }: { api: Api; p: Promoter; onClose: () => void; onDone: () => void }) {
  const [pct, setPct] = useState(String(p.commissionPct ?? 10));
  const [cap, setCap] = useState(String(Math.round((p.commissionCapMinor ?? 5_000_000) / 100)));
  const [note, setNote] = useState(p.commissionNote ?? '');
  const [err, setErr] = useState<string | null>(null);
  const run = useMutation({ mutationFn: () => api.patch(`/owner/referrals/promoters/${p.id}/commission`, { pct: Number(pct), capMinor: Math.round(Number(cap) * 100), note: note.trim() || undefined }), onSuccess: () => { toast.success(`${p.name} now sees ${pct}%.`); onDone(); }, onError: (e) => setErr(msg(e)) });
  return (
    <Overlay title={`Commission for ${p.name}`} subtitle={`${p.who ?? '—'} · expects ${p.expect ?? '—'} · ${p.areas ?? p.city ?? ''}`} onClose={onClose} side="center"
      footer={<>{err ? <span className="sk-state err">{err}</span> : <span />}<button className="sk-btn" onClick={onClose}>Cancel</button><button className="sk-btn" data-variant="primary" disabled={run.isPending || !(Number(pct) >= 1 && Number(pct) <= 50)} onClick={() => run.mutate()}>Set commission</button></>}>
      <FieldRow min={140}>
        <Field id="sr-pct" label="Commission %">{(f) => <input {...f} className="sk-input" type="number" min={1} max={50} value={pct} onChange={(e) => setPct(e.target.value)} />}</Field>
        <Field id="sr-cap" label="Cap per school (₹, 0 = none)">{(f) => <input {...f} className="sk-input" type="number" min={0} value={cap} onChange={(e) => setCap(e.target.value)} />}</Field>
      </FieldRow>
      <Field id="sr-note" label="Note the promoter sees">{(f) => <textarea {...f} className="sk-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      {p.know && <p className="sk-muted" style={{ margin: 0, fontSize: 13 }}><b>How they know schools:</b> {p.know}</p>}
    </Overlay>
  );
}

// ─── Referrals ──────────────────────────────────────────────────────────────

function ReferralsTab({ api, enabled, onDone }: { api: Api; enabled: boolean; onDone: () => void }) {
  const [q, setQ] = useState(''); const [pid, setPid] = useState(''); const [city, setCity] = useState(''); const [status, setStatus] = useState('');
  const [live, setLive] = useState<Referral | null>(null);
  const [lost, setLost] = useState<Referral | null>(null);
  const list = useQuery({ queryKey: ['owner-ref-referrals', q, pid, city, status], queryFn: () => api.get<Referral[]>(`/owner/referrals?${new URLSearchParams({ ...(q ? { q } : {}), ...(pid ? { promoterId: pid } : {}), ...(city ? { city } : {}), ...(status ? { status } : {}) })}`), enabled });
  const promoters = useQuery({ queryKey: ['owner-ref-promoters', '', '', ''], queryFn: () => api.get<Promoter[]>('/owner/referrals/promoters'), enabled });
  const cities = useMemo(() => [...new Set((list.data ?? []).map((r) => r.city).filter(Boolean))], [list.data]);
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: () => { toast.success('Done.'); onDone(); void list.refetch(); }, onError: (e) => toast.error(msg(e)) });
  const rows = list.data ?? [];
  const figures = { logged: rows.length, inProgress: rows.filter((r) => !['PAYOUT_DUE', 'PAID', 'LIVE', 'REJECTED', 'LOST'].includes(r.status)).length, live: rows.filter((r) => ['LIVE', 'PAYOUT_DUE', 'PAID'].includes(r.status)).length, owedMinor: rows.filter((r) => r.payout && r.payout.status === 'DUE').reduce((a, r) => a + (r.payout?.netMinor ?? 0), 0) };
  return (
    <>
      <div className="sk-kpis" style={{ marginBottom: 12 }}>
        {[['Logged', String(figures.logged)], ['In progress', String(figures.inProgress)], ['Live', String(figures.live)], ['Owed', rupees(figures.owedMinor)]].map(([l, v]) => <div key={l} className="sk-kpi"><span className="lab">{l}</span><span className="n">{v}</span></div>)}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input className="sk-input" style={{ width: 240 }} placeholder="Search school, contact, phone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search referrals" />
        <select className="sk-input" style={{ width: 'auto' }} value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Promoter"><option value="">Any promoter</option>{(promoters.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="sk-input" style={{ width: 'auto' }} value={city} onChange={(e) => setCity(e.target.value)} aria-label="City"><option value="">Any city</option>{cities.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="sk-input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Stage"><option value="">Any stage</option>{(Object.keys(STAGE_LABEL) as ReferralStatus[]).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select>
      </div>
      {list.isLoading ? <p className="sk-state">Loading referrals…</p> : list.isError ? <QueryError error={list.error} onRetry={list.refetch} /> : (
        <div className="sk-card">
          <RowList columns="minmax(0,1.4fr) minmax(0,1fr) minmax(0,.8fr) auto auto auto" label="Referrals">
            {rows.map((r) => {
              const next = NEXT[r.status];
              return (
                <Row key={r.id}>
                  <Cell><RowTitle title={<>{r.schoolName}{r.viaLink && <span className="sk-pill" data-tone="info">via link</span>}{r.lapsed && <span className="sk-pill" data-tone="neutral">lapsed</span>}</>} sub={`${[r.area, r.city].filter(Boolean).join(', ')}${r.studentsApprox ? ` · ~${r.studentsApprox} students` : ''} · logged ${when(r.createdAt)}`} /></Cell>
                  <Cell><RowTitle title={r.contactName} sub={<>{r.contactRole ? `${r.contactRole} · ` : ''}{r.contactPhone}{!r.consent && <span style={{ color: 'var(--sk-bad)' }}> · no consent</span>}</>} /></Cell>
                  <Cell><RowTitle title={r.promoter.name} sub={r.promoter.commissionPct ? `${r.promoter.commissionPct}%` : 'rate not set'} /></Cell>
                  <Cell><Pill s={r.status} />{r.statusReason && (r.status === 'REJECTED' || r.status === 'LOST') && <div className="sk-muted" style={{ fontSize: 11.5 }}>{r.statusReason}</div>}</Cell>
                  <Cell align="end">{r.rewardMinor ? <b>{rupees(r.rewardMinor)}</b> : '—'}</Cell>
                  <Cell>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {next && next !== 'LIVE' && <button className="sk-btn" disabled={run.isPending} onClick={() => run.mutate(() => next === 'ACCEPTED' ? api.post(`/owner/referrals/${r.id}/accept`, {}) : api.patch(`/owner/referrals/${r.id}/stage`, { status: next }))}>→ {STAGE_LABEL[next]}</button>}
                      {next === 'LIVE' && <button className="sk-btn" data-variant="primary" onClick={() => setLive(r)}>→ Live &amp; paid</button>}
                      {!['REJECTED', 'LOST', 'PAID', 'PAYOUT_DUE', 'LIVE'].includes(r.status) && <button className="sk-btn" data-icon data-tone="bad" onClick={() => setLost(r)}>{r.status === 'LOGGED' ? 'Reject' : 'Lost'}</button>}
                    </div>
                  </Cell>
                </Row>
              );
            })}
            {rows.length === 0 && <p className="sk-muted" style={{ padding: 16, margin: 0 }}>No referral matches.</p>}
          </RowList>
        </div>
      )}
      {live && <MarkLive api={api} r={live} onClose={() => setLive(null)} onDone={() => { setLive(null); onDone(); void list.refetch(); }} />}
      {lost && <CloseReferral api={api} r={lost} onClose={() => setLost(null)} onDone={() => { setLost(null); onDone(); void list.refetch(); }} />}
    </>
  );
}

function MarkLive({ api, r, onClose, onDone }: { api: Api; r: Referral; onClose: () => void; onDone: () => void }) {
  const [inv, setInv] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const pct = r.promoter.commissionPct;
  const cap = r.promoter.commissionCapMinor;
  const preview = pct && Number(inv) > 0 ? Math.min(Math.round(Number(inv) * 100 * pct / 100), cap || Infinity) : 0;
  const run = useMutation({ mutationFn: () => api.patch(`/owner/referrals/${r.id}/stage`, { status: 'LIVE', invoiceMinor: Math.round(Number(inv) * 100) }), onSuccess: () => { toast.success(`${r.schoolName} is live; the payout is in the queue.`); onDone(); }, onError: (e) => setErr(msg(e)) });
  return (
    <Overlay title={`${r.schoolName} is live and has paid`} subtitle="The first-year invoice decides the reward. One payout per school, ever." onClose={onClose} side="center"
      footer={<>{err ? <span className="sk-state err">{err}</span> : <span />}<button className="sk-btn" onClick={onClose}>Cancel</button><button className="sk-btn" data-variant="primary" disabled={run.isPending || !(Number(inv) > 0) || !pct} onClick={() => run.mutate()}>Mark live</button></>}>
      {!pct && <div className="sk-note" data-tone="bad">{r.promoter.name} has no commission rate yet. Set it under Promoters first.</div>}
      <Field id="ml-inv" label="First-year invoice (₹, what the school paid)">{(f) => <input {...f} className="sk-input" type="number" min={1} value={inv} onChange={(e) => setInv(e.target.value)} autoFocus />}</Field>
      <p className="sk-muted" style={{ margin: 0 }}>Reward: <b>{preview ? rupees(preview) : '—'}</b>{pct ? ` (${pct}%${cap ? `, cap ${rupees(cap)}` : ''})` : ''}. TDS is deducted at the rate in Settings; the promoter is emailed.</p>
    </Overlay>
  );
}

function CloseReferral({ api, r, onClose, onDone }: { api: Api; r: Referral; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const reject = r.status === 'LOGGED';
  const run = useMutation({ mutationFn: () => reject ? api.post(`/owner/referrals/${r.id}/reject`, { reason: reason.trim() }) : api.patch(`/owner/referrals/${r.id}/stage`, { status: 'LOST', reason: reason.trim() }), onSuccess: () => { toast.success(reject ? 'Rejected; the promoter sees the reason.' : 'Marked lost.'); onDone(); }, onError: (e) => setErr(msg(e)) });
  return (
    <Overlay title={reject ? `Reject ${r.schoolName}` : `${r.schoolName}: lost`} subtitle={reject ? 'The promoter sees this reason.' : 'The lead is marked lost too.'} onClose={onClose} side="center"
      footer={<>{err ? <span className="sk-state err">{err}</span> : <span />}<button className="sk-btn" onClick={onClose}>Cancel</button><button className="sk-btn" data-variant="primary" disabled={run.isPending || (reject && reason.trim().length < 3)} onClick={() => run.mutate()}>{reject ? 'Reject' : 'Mark lost'}</button></>}>
      <Field id="cr-reason" label={reject ? 'Why (required)' : 'Why (optional)'}>{(f) => <textarea {...f} className="sk-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}</Field>
    </Overlay>
  );
}

// ─── Payouts ────────────────────────────────────────────────────────────────

function Payouts({ api, q, onDone }: { api: Api; q: ReturnType<typeof useQuery<Payout[]>>; onDone: () => void }) {
  const [paying, setPaying] = useState<Payout | null>(null);
  if (q.isLoading) return <p className="sk-state">Loading payouts…</p>;
  if (q.isError) return <QueryError error={q.error} onRetry={q.refetch} />;
  const rows = q.data ?? [];
  const csv = () => {
    const lines = [['Promoter', 'PAN', 'School', 'Gross', 'TDS', 'Net', 'Due', 'Status', 'UTR', 'Paid on'].join(',')].concat(rows.map((y) => [y.promoter.name, y.promoter.panMasked ?? '', y.referral.schoolName, y.grossMinor / 100, y.tdsMinor / 100, y.netMinor / 100, when(y.dueOn), y.status, y.utr ?? '', y.paidOn ? when(y.paidOn) : ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `sckools-referral-payouts-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}><button className="sk-btn" onClick={csv} disabled={rows.length === 0}>Export for the accountant</button></div>
      <div className="sk-card">
        <RowList columns="minmax(0,1.2fr) minmax(0,1fr) auto auto auto auto auto" label="Payouts">
          {rows.map((y) => (
            <Row key={y.id}>
              <Cell><RowTitle title={y.promoter.name} sub={y.promoter.detailsComplete ? `${y.promoter.payeeName} · ${y.promoter.upi || `${y.promoter.bankAccountMasked} ${y.promoter.ifsc ?? ''}`} · PAN ${y.promoter.panMasked}${y.promoter.kycVerified ? '' : ' · not verified'}` : <span style={{ color: 'var(--sk-amber-ink)' }}>no payout details yet</span>} /></Cell>
              <Cell><RowTitle title={y.referral.schoolName} sub={`${y.referral.city}${y.referral.invoiceMinor ? ` · invoice ${rupees(y.referral.invoiceMinor)}` : ''}`} /></Cell>
              <Cell align="end"><RowTitle title={rupees(y.grossMinor)} sub="gross" /></Cell>
              <Cell align="end"><RowTitle title={rupees(y.tdsMinor)} sub="TDS" /></Cell>
              <Cell align="end"><RowTitle title={<b>{rupees(y.netMinor)}</b>} sub="net" /></Cell>
              <Cell><RowTitle title={when(y.dueOn)} sub="due" /></Cell>
              <Cell>{y.status === 'PAID' ? <RowTitle title={<span className="sk-pill" data-tone="good">Paid</span>} sub={`${y.utr} · ${when(y.paidOn!)}`} /> : <button className="sk-btn" data-variant="primary" disabled={!y.promoter.detailsComplete} title={y.promoter.detailsComplete ? undefined : 'Ask the promoter for payout details first'} onClick={() => setPaying(y)}>Mark paid</button>}</Cell>
            </Row>
          ))}
          {rows.length === 0 && <p className="sk-muted" style={{ padding: 16, margin: 0 }}>Nothing owed. Payouts appear here when a referred school is marked live.</p>}
        </RowList>
      </div>
      {paying && <MarkPaid api={api} y={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); onDone(); void q.refetch(); }} />}
    </>
  );
}

function MarkPaid({ api, y, onClose, onDone }: { api: Api; y: Payout; onClose: () => void; onDone: () => void }) {
  const [utr, setUtr] = useState(''); const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);
  const run = useMutation({ mutationFn: () => api.patch(`/owner/referrals/payouts/${y.id}/paid`, { utr: utr.trim(), paidOn }), onSuccess: () => { toast.success('Marked paid; the promoter is told.'); onDone(); }, onError: (e) => setErr(msg(e)) });
  return (
    <Overlay title={`Pay ${rupees(y.netMinor)} to ${y.promoter.name}`} subtitle={`${y.referral.schoolName} · gross ${rupees(y.grossMinor)}, TDS ${rupees(y.tdsMinor)}`} onClose={onClose} side="center"
      footer={<>{err ? <span className="sk-state err">{err}</span> : <span />}<button className="sk-btn" onClick={onClose}>Cancel</button><button className="sk-btn" data-variant="primary" disabled={run.isPending || utr.trim().length < 4} onClick={() => run.mutate()}>Mark paid</button></>}>
      <p className="sk-muted" style={{ margin: 0 }}>Pay to: {y.promoter.payeeName} · {y.promoter.upi || `${y.promoter.bankAccountMasked} · ${y.promoter.ifsc}`}</p>
      <FieldRow>
        <Field id="mp-utr" label="UTR / reference">{(f) => <input {...f} className="sk-input" value={utr} onChange={(e) => setUtr(e.target.value)} autoFocus />}</Field>
        <Field id="mp-date" label="Paid on">{(f) => <input {...f} className="sk-input" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}</Field>
      </FieldRow>
    </Overlay>
  );
}

// ─── Settings ───────────────────────────────────────────────────────────────

function SettingsTab({ api, enabled }: { api: Api; enabled: boolean }) {
  const q = useQuery({ queryKey: ['owner-ref-settings'], queryFn: () => api.get<Settings>('/owner/referrals/settings'), enabled });
  const [f, setF] = useState<Settings | null>(null);
  const s = f ?? q.data ?? null;
  const run = useMutation({ mutationFn: () => api.put<Settings>('/owner/referrals/settings', s), onSuccess: () => { toast.success('Saved.'); void q.refetch(); }, onError: (e) => toast.error(msg(e)) });
  if (q.isLoading || !s) return q.isError ? <QueryError error={q.error} onRetry={q.refetch} /> : <p className="sk-state">Loading settings…</p>;
  const upd = (patch: Partial<Settings>) => setF({ ...s, ...patch });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 12 }}>
      <div className="sk-card">
        <div className="sk-card-h"><h3>Suggested rate by expected schools</h3><p className="sk-muted">Pre-fills the Tasks tab. Never shown to promoters; every rate is still set by you per person.</p></div>
        <div className="sk-card-b">
          {Object.entries(s.ladder).map(([k, v]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10, alignItems: 'center', fontSize: 13.5 }}>
              <span>{k} schools in six months</span>
              <input className="sk-input" type="number" min={0} max={100} value={v} onChange={(e) => upd({ ladder: { ...s.ladder, [k]: Number(e.target.value) } })} aria-label={`Rate for ${k}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="sk-card">
        <div className="sk-card-h"><h3>Money and time</h3></div>
        <div className="sk-card-b">
          <Field id="st-cap" label="Default cap per school (₹, 0 = none)">{(p) => <input {...p} className="sk-input" type="number" min={0} value={Math.round(s.capMinor / 100)} onChange={(e) => upd({ capMinor: Math.round(Number(e.target.value) * 100) })} />}</Field>
          <Field id="st-tds" label="TDS deducted (%)">{(p) => <input {...p} className="sk-input" type="number" min={0} max={30} value={s.tdsPct} onChange={(e) => upd({ tdsPct: Number(e.target.value) })} />}</Field>
          <Field id="st-pay" label="Payout due, days after the school's first payment">{(p) => <input {...p} className="sk-input" type="number" min={0} max={365} value={s.payoutDays} onChange={(e) => upd({ payoutDays: Number(e.target.value) })} />}</Field>
          <Field id="st-attr" label="Attribution window, days">{(p) => <input {...p} className="sk-input" type="number" min={7} max={730} value={s.attributionDays} onChange={(e) => upd({ attributionDays: Number(e.target.value) })} />}</Field>
          <div><button className="sk-btn" data-variant="primary" disabled={run.isPending} onClick={() => run.mutate()}>Save</button></div>
        </div>
      </div>
    </div>
  );
}
