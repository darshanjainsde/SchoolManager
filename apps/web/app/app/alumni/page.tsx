'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import type {
  AlumniSummary,
  ClaimRow,
  GiftGroups,
  GiftItemRow,
  PledgeRow,
  RollCallRow,
  SchoolClass,
  SessionConflicts,
  SessionRow,
  SlotsResult,
  TeacherRow,
} from './types';

/**
 * The Alumni Office — the school's side of Homecoming.
 *
 * Five tabs, and every one of them is a queue or a board the coordinator works
 * through. The alumnus-facing half (the passwordless door, public batch pages,
 * the Give and Sessions tabs an alumnus sees) is a separate slice; this screen
 * deliberately contains everything a school does WITHOUT needing that to exist,
 * so it can be tested and audited on its own.
 */

type Tab = 'office' | 'verify' | 'rollcall' | 'gifts' | 'sessions';

const TABS: { id: Tab; label: string }[] = [
  { id: 'office', label: 'Alumni Office' },
  { id: 'verify', label: 'Verification' },
  { id: 'rollcall', label: 'Roll Call' },
  { id: 'gifts', label: 'Gifts' },
  { id: 'sessions', label: 'Session requests' },
];

const rupees = (minor: number, currency = 'INR') =>
  currency === 'INR'
    ? `₹${(minor / 100).toLocaleString('en-IN')}`
    : `${currency} ${(minor / 100).toLocaleString()}`;

const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`.trim();

/** YYYY-MM-DD `n` days from today, in UTC so a device in IST does not shift it. */
function ymdFromToday(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function errText(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

export default function AlumniOfficePage() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('office');

  const summary = useQuery({
    queryKey: ['alumni', 'summary'],
    queryFn: () => api.get<AlumniSummary>('/manage/alumni/summary'),
    enabled: !!host,
    staleTime: 20_000,
  });

  const invalidateAll = () => qc.invalidateQueries({ queryKey: ['alumni'] });

  return (
    <div className="skosx">
      <header className="sk-pagehead">
        <div>
          <h1>Alumni Office</h1>
          <p>
            The school never had an alumni database — it had a graduating class every March.
            This is where the ones already lost get recovered, and where the ones still here
            stop being lost.
          </p>
        </div>
      </header>

      <nav className="sk-tabs" style={{ marginBottom: 18 }} aria-label="Alumni Office sections">
        {TABS.map((t) => {
          const badge =
            t.id === 'verify'
              ? summary.data?.pendingClaims
              : t.id === 'gifts'
                ? summary.data?.openPledges
                : t.id === 'sessions'
                  ? summary.data?.openSessions
                  : 0;
          return (
            <button
              key={t.id}
              type="button"
              className="sk-tab"
              aria-current={tab === t.id ? 'page' : undefined}
              style={
                tab === t.id
                  ? { borderBottomColor: 'var(--sk-brand)', color: 'var(--sk-brand-2)' }
                  : undefined
              }
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {badge ? (
                <span className="sk-pill" style={{ background: 'var(--sk-amber-tint)', color: 'var(--sk-amber-ink)' }}>
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {tab === 'office' && <OfficeTab summary={summary.data} onGo={setTab} onChanged={invalidateAll} />}
      {tab === 'verify' && <VerifyTab onChanged={invalidateAll} />}
      {tab === 'rollcall' && <RollCallTab />}
      {tab === 'gifts' && <GiftsTab onChanged={invalidateAll} />}
      {tab === 'sessions' && <SessionsTab onChanged={invalidateAll} />}
    </div>
  );
}

// ─── Office ──────────────────────────────────────────────────────────────────

function OfficeTab({
  summary,
  onGo,
  onChanged,
}: {
  summary?: AlumniSummary;
  onGo: (t: Tab) => void;
  onChanged: () => void;
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [picked, setPicked] = useState<string[]>([]);
  const [batchYear, setBatchYear] = useState(new Date().getFullYear());

  const classes = useQuery({
    queryKey: ['alumni', 'classes'],
    queryFn: () => api.get<SchoolClass[]>('/manage/classes'),
    enabled: !!host,
    staleTime: 60_000,
  });

  const graduate = useMutation({
    mutationFn: () =>
      api.post<{ considered: number; created: number; alreadyPresent: number; guardianPhonesOnFile: number }>(
        '/manage/alumni/graduate',
        { classSectionIds: picked, batchYear },
      ),
    onSuccess: (r) => {
      onChanged();
      setPicked([]);
      toast.success(
        r.created === 0
          ? `Nothing new — all ${r.considered} were already in the alumni roll.`
          : `${r.created} alumni created from ${r.considered} children.` +
              (r.alreadyPresent ? ` ${r.alreadyPresent} were already there.` : ''),
      );
    },
    onError: (e) => toast.error(errText(e, 'Could not graduate that batch.')),
  });

  const total = picked.reduce(
    (n, id) => n + (classes.data?.find((c) => c.id === id)?._count.students ?? 0),
    0,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="sk-kpis">
        <Kpi label="Alumni traced" n={summary?.total ?? 0} hint={`${summary?.batches ?? 0} batches · ${summary?.cities ?? 0} cities`} />
        <Kpi label="Verified" n={summary?.verified ?? 0} hint="a human matched them to the register" />
        <Kpi
          label="Awaiting verification"
          n={summary?.pendingClaims ?? 0}
          hint={summary?.pendingClaims ? 'nobody sees them until you decide' : 'queue is clear'}
        />
        <Kpi label="Open gifts" n={summary?.openPledges ?? 0} hint="waiting on the office" />
      </div>

      <section className="sk-card">
        <div className="sk-card-h">
          <h3>Graduate a batch</h3>
          <p>
            The forward engine. Every child in the classes you tick becomes an alumni record
            carrying their admission number, class and photograph — with nothing typed. Press it
            twice and you get the batch once, not twice.
          </p>
        </div>
        <div className="sk-card-b">
          <label className="sk-lab" htmlFor="batchYear">
            Leaving year
          </label>
          <input
            id="batchYear"
            className="sk-input"
            type="number"
            min={1900}
            max={2100}
            style={{ maxWidth: 140 }}
            value={batchYear}
            onChange={(e) => setBatchYear(Number(e.target.value))}
          />

          {classes.isLoading ? (
            <p className="sk-state">Loading classes…</p>
          ) : !classes.data?.length ? (
            <p className="sk-state">No classes are set up yet.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {classes.data.map((c) => {
                const on = picked.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="sk-chip"
                    aria-pressed={on}
                    style={
                      on
                        ? {
                            borderColor: 'var(--sk-brand)',
                            background: 'var(--sk-brand-tint)',
                            color: 'var(--sk-brand-2)',
                          }
                        : undefined
                    }
                    onClick={() =>
                      setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))
                    }
                  >
                    {c.grade ? `${c.grade.name} – ${c.name}` : c.name}
                    <span className="sk-num" style={{ marginLeft: 6, opacity: 0.7 }}>
                      {c._count.students}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {picked.length > 0 && (
            <div className="sk-notice" style={{ borderLeft: '3px solid var(--sk-amber)', background: 'var(--sk-amber-tint)', padding: '11px 14px', borderRadius: 9, color: 'var(--sk-amber-ink)', fontSize: 13, lineHeight: 1.55 }}>
              <strong>{total} children</strong> become the Class of {batchYear}.
              <br />
              The phone number on file belongs to a <strong>parent</strong>, so it is kept for the
              invite and never written into the alumnus&rsquo;s own phone field. Ask the
              school-leaver for their own on the day they collect their certificate.
            </div>
          )}

          <button
            type="button"
            className="sk-btn"
            style={{ background: 'var(--sk-brand)', borderColor: 'var(--sk-brand)', color: '#fff', alignSelf: 'flex-start' }}
            disabled={picked.length === 0 || graduate.isPending}
            onClick={() => graduate.mutate()}
          >
            {graduate.isPending ? 'Graduating…' : `Graduate ${picked.length || ''} ${picked.length === 1 ? 'class' : 'classes'}`}
          </button>
        </div>
      </section>

      <div className="sk-cardgrid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
        <QueueCard
          title="Verification"
          body={
            summary?.pendingClaims
              ? `${summary.pendingClaims} claim${summary.pendingClaims === 1 ? '' : 's'} waiting. Each sits beside the register row it probably matches.`
              : 'Nothing waiting. A claim never becomes visible by ageing — only by you deciding.'
          }
          onGo={() => onGo('verify')}
        />
        <QueueCard
          title="Gifts"
          body={
            summary?.openPledges
              ? `${summary.openPledges} pledge${summary.openPledges === 1 ? '' : 's'} need a decision.`
              : 'No pledges waiting.'
          }
          onGo={() => onGo('gifts')}
        />
        <QueueCard
          title="Session requests"
          body={
            summary?.openSessions
              ? `${summary.openSessions} request${summary.openSessions === 1 ? '' : 's'}. You can suggest another time instead of refusing.`
              : 'No requests waiting.'
          }
          onGo={() => onGo('sessions')}
        />
      </div>
    </div>
  );
}

function Kpi({ label, n, hint }: { label: string; n: number; hint: string }) {
  return (
    <div className="sk-kpi">
      <span className="lab">{label}</span>
      <span className="n sk-num">{n.toLocaleString('en-IN')}</span>
      <span className="hint">{hint}</span>
    </div>
  );
}

function QueueCard({ title, body, onGo }: { title: string; body: string; onGo: () => void }) {
  return (
    <section className="sk-card">
      <div className="sk-card-h">
        <h3>{title}</h3>
      </div>
      <div className="sk-card-b">
        <p className="sk-muted">{body}</p>
        <button type="button" className="sk-btn" style={{ alignSelf: 'flex-start' }} onClick={onGo}>
          Open
        </button>
      </div>
    </section>
  );
}

// ─── Verification ────────────────────────────────────────────────────────────

function VerifyTab({ onChanged }: { onChanged: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const claims = useQuery({
    queryKey: ['alumni', 'claims'],
    queryFn: () => api.get<ClaimRow[]>('/manage/alumni/claims?status=PENDING'),
    enabled: !!host,
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; action: 'VERIFY' | 'DECLINE'; reason?: string }) =>
      api.post(`/manage/alumni/claims/${v.id}/decide`, { action: v.action, reason: v.reason }),
    onSuccess: (_r, v) => {
      onChanged();
      toast.success(v.action === 'VERIFY' ? 'Verified.' : 'Declined, with the reason sent.');
    },
    onError: (e) => toast.error(errText(e, 'Could not decide that claim.')),
  });

  if (claims.isLoading) return <p className="sk-state">Loading the queue…</p>;
  if (!claims.data?.length) {
    return (
      <section className="sk-card">
        <div className="sk-card-b">
          <p className="sk-state">
            The queue is clear. Nobody is waiting, and nobody unverified is visible to another
            human being.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {claims.data.map((c) => (
        <section className="sk-card" key={c.id}>
          <div className="sk-card-h">
            <h3>{fullName(c)}</h3>
            <span className="sk-pill" style={{ background: 'var(--sk-bg-2)', color: 'var(--sk-ink-3)' }}>
              Class of {c.batchYear}
            </span>
            {c.vouchedByAlumniId && (
              <span className="sk-pill" style={{ background: 'var(--sk-good-tint)', color: 'var(--sk-good)' }}>
                vouched
              </span>
            )}
          </div>
          <div className="sk-card-b">
            <p className="sk-muted">
              <strong>Admission number claimed:</strong> {c.claimedAdmissionNo || '— not remembered —'}
              <br />
              <strong>Proof offered:</strong> {c.proof}
              {(c.email || c.phone) && (
                <>
                  <br />
                  <strong>Contact:</strong> {[c.email, c.phone].filter(Boolean).join(' · ')}
                </>
              )}
            </p>
            <label className="sk-lab" htmlFor={`reason-${c.id}`}>
              Reason (required to decline)
            </label>
            <input
              id={`reason-${c.id}`}
              className="sk-input"
              placeholder="No matching row in the 1992 register…"
              value={reasons[c.id] ?? ''}
              onChange={(e) => setReasons((r) => ({ ...r, [c.id]: e.target.value }))}
            />
            <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="sk-btn"
                style={{ background: 'var(--sk-good)', borderColor: 'var(--sk-good)', color: '#fff' }}
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: c.id, action: 'VERIFY' })}
              >
                Verify
              </button>
              <button
                type="button"
                className="sk-btn"
                style={{ color: 'var(--sk-bad)' }}
                disabled={decide.isPending || !(reasons[c.id] ?? '').trim()}
                onClick={() => decide.mutate({ id: c.id, action: 'DECLINE', reason: reasons[c.id] })}
              >
                Decline
              </button>
            </div>
            <p className="sk-muted">
              Declining requires a reason — the office owes one, and requiring it is the cheapest
              way to make &ldquo;ask them for more proof&rdquo; the easier path.
            </p>
          </div>
        </section>
      ))}
    </div>
  );
}

// ─── Roll Call ───────────────────────────────────────────────────────────────

function RollCallTab() {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Record<number, string>>({});

  const roll = useQuery({
    queryKey: ['alumni', 'rollcall'],
    queryFn: () => api.get<RollCallRow[]>('/manage/alumni/roll-call'),
    enabled: !!host,
  });

  const save = useMutation({
    mutationFn: (v: { batchYear: number; registerStrength: number }) =>
      api.put('/manage/alumni/roll-call', v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alumni', 'rollcall'] });
      toast.success('Strength recorded.');
    },
    onError: (e) => toast.error(errText(e, 'Could not save that.')),
  });

  if (roll.isLoading) return <p className="sk-state">Loading the board…</p>;
  if (!roll.data?.length) {
    return (
      <section className="sk-card">
        <div className="sk-card-b">
          <p className="sk-state">
            No batches yet. Graduate a class, or type in a year&rsquo;s strength from the bound
            register to start the board.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="sk-card">
      <div className="sk-card-h">
        <h3>Batch coverage</h3>
        <p>
          One row per year: how many of that batch have been found. The strength for years
          before Sckools comes from the bound register and is typed in once — until it is, the
          bar has no denominator and says so rather than drawing a full one.
        </p>
      </div>
      <div className="sk-card-b">
        {roll.data.map((r) => {
          const draft = edit[r.batchYear] ?? String(r.registerStrength || '');
          return (
            <div key={r.batchYear} className="sk-row" style={{ alignItems: 'center', gap: 12 }}>
              <span className="sk-num" style={{ width: 52, fontWeight: 600 }}>
                {r.batchYear}
              </span>
              <div className="sp" style={{ flex: 1, minWidth: 0 }}>
                {r.coverage === null ? (
                  <p className="sk-muted" style={{ margin: 0 }}>
                    {r.found} found · strength not recorded
                  </p>
                ) : (
                  <>
                    <div className="sk-progress" style={{ marginTop: 0 }}>
                      <div
                        className="sk-progress-fill"
                        style={{
                          width: `${r.coverage}%`,
                          background: r.fromSckools
                            ? 'var(--sk-brand)'
                            : 'color-mix(in srgb, var(--sk-brand) 44%, var(--sk-line))',
                        }}
                      />
                    </div>
                    <p className="sk-muted" style={{ margin: '4px 0 0' }}>
                      <span className="sk-num">{r.found}</span> of{' '}
                      <span className="sk-num">{r.registerStrength}</span> found ·{' '}
                      <span className="sk-num">{r.verified}</span> verified
                      {r.fromSckools ? ' · graduated through Sckools' : ''}
                    </p>
                  </>
                )}
              </div>
              <input
                className="sk-input"
                type="number"
                min={0}
                max={5000}
                aria-label={`Register strength for ${r.batchYear}`}
                style={{ width: 96 }}
                value={draft}
                onChange={(e) => setEdit((x) => ({ ...x, [r.batchYear]: e.target.value }))}
              />
              <button
                type="button"
                className="sk-btn"
                disabled={save.isPending || draft === '' || Number(draft) === r.registerStrength}
                onClick={() =>
                  save.mutate({ batchYear: r.batchYear, registerStrength: Number(draft) })
                }
              >
                Save
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Gifts ───────────────────────────────────────────────────────────────────

function GiftsTab({ onChanged }: { onChanged: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [recv, setRecv] = useState<Record<string, string>>({});
  const [absent, setAbsent] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});

  const pledges = useQuery({
    queryKey: ['alumni', 'pledges'],
    queryFn: () => api.get<PledgeRow[]>('/manage/alumni/pledges'),
    enabled: !!host,
  });
  const items = useQuery({
    queryKey: ['alumni', 'gift-items'],
    queryFn: () => api.get<GiftItemRow[]>('/manage/alumni/gift-items?all=1'),
    enabled: !!host,
  });
  const groups = useQuery({
    queryKey: ['alumni', 'gift-groups'],
    queryFn: () => api.get<GiftGroups>('/manage/alumni/gift-groups'),
    enabled: !!host,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['alumni', 'pledges'] });
    onChanged();
  };

  const act = useMutation({
    mutationFn: (v: { id: string; path: string; body: unknown }) =>
      api.post(`/manage/alumni/pledges/${v.id}/${v.path}`, v.body),
    onSuccess: () => refresh(),
    onError: (e) => toast.error(errText(e, 'That did not work.')),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <CatalogueCard items={items.data ?? []} groups={groups.data} onChanged={() => qc.invalidateQueries({ queryKey: ['alumni', 'gift-items'] })} />

      {pledges.isLoading && <p className="sk-state">Loading pledges…</p>}
      {pledges.data?.length === 0 && (
        <section className="sk-card">
          <div className="sk-card-b">
            <p className="sk-state">No pledges yet.</p>
          </div>
        </section>
      )}

      {pledges.data?.map((p) => {
        const who = p.alumni ? `${fullName(p.alumni)}, Class of ${p.alumni.batchYear}` : (p.donorName ?? 'A donor');
        const what = p.giftItem?.name ?? p.customRequest ?? 'Something off-list';
        return (
          <section className="sk-card" key={p.id}>
            <div className="sk-card-h">
              <h3>
                {p.quantity} × {what.toLowerCase()}
              </h3>
              <span className="sk-pill" style={{ background: p.mode === 'FUND' ? 'var(--sk-brand-tint)' : 'var(--sk-amber-tint)', color: p.mode === 'FUND' ? 'var(--sk-brand-2)' : 'var(--sk-amber-ink)' }}>
                {p.mode === 'FUND' ? 'FUND' : 'SUPPLY · no valuation'}
              </span>
              <span className="sp" style={{ flex: 1 }} />
              <span className="sk-pill" style={{ background: 'var(--sk-bg-2)', color: 'var(--sk-ink-3)' }}>
                {p.status}
              </span>
              <p>
                {who} · for a group of {p.headcountAtPledge} children
                {p.mode === 'FUND' && p.amountMinor != null ? ` · ${rupees(p.amountMinor, p.currency)}` : ''}
                {p.dedicationText ? ` · “${p.dedicationText}”` : ''}
              </p>
            </div>
            <div className="sk-card-b">
              {p.status === 'PROPOSED' && (
                <>
                  <p className="sk-muted">
                    Three answers, and the middle one matters most — a flat decline ends the
                    conversation and the donor does not come back.
                  </p>
                  <input
                    className="sk-input"
                    placeholder="Reason, or what the school needs instead…"
                    value={note[p.id] ?? ''}
                    onChange={(e) => setNote((n) => ({ ...n, [p.id]: e.target.value }))}
                  />
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                    <button type="button" className="sk-btn" style={{ background: 'var(--sk-good)', borderColor: 'var(--sk-good)', color: '#fff' }}
                      onClick={() => act.mutate({ id: p.id, path: 'decide', body: { action: 'ACCEPT' } })}>
                      Accept
                    </button>
                    <button type="button" className="sk-btn" style={{ background: 'var(--sk-amber-tint)', borderColor: 'var(--sk-amber)', color: 'var(--sk-amber-ink)' }}
                      disabled={!(note[p.id] ?? '').trim()}
                      onClick={() => act.mutate({ id: p.id, path: 'decide', body: { action: 'COUNTER', counterNote: note[p.id] } })}>
                      Suggest something else
                    </button>
                    <button type="button" className="sk-btn" style={{ color: 'var(--sk-bad)' }}
                      disabled={!(note[p.id] ?? '').trim()}
                      onClick={() => act.mutate({ id: p.id, path: 'decide', body: { action: 'DECLINE', reason: note[p.id] } })}>
                      Decline
                    </button>
                  </div>
                </>
              )}

              {p.status === 'ACCEPTED' && (
                <>
                  <p className="sk-muted">
                    Accepted{p.dueAt ? ` — due ${p.dueAt.slice(0, 10)}` : ''}. Pledged and received
                    are two different numbers and both get written down.
                  </p>
                  <label className="sk-lab" htmlFor={`recv-${p.id}`}>
                    How many actually arrived (pledged {p.quantity})
                  </label>
                  <input id={`recv-${p.id}`} className="sk-input" type="number" min={1} style={{ maxWidth: 140 }}
                    value={recv[p.id] ?? String(p.quantity)}
                    onChange={(e) => setRecv((r) => ({ ...r, [p.id]: e.target.value }))} />
                  <button type="button" className="sk-btn" style={{ alignSelf: 'flex-start', background: 'var(--sk-brand)', borderColor: 'var(--sk-brand)', color: '#fff' }}
                    onClick={() => act.mutate({ id: p.id, path: 'receive', body: { receivedQty: Number(recv[p.id] ?? p.quantity) } })}>
                    Record what arrived
                  </button>
                </>
              )}

              {p.status === 'RECEIVED' && !p.canDistribute && (
                <>
                  <div style={{ borderLeft: '3px solid var(--sk-amber)', background: 'var(--sk-amber-tint)', color: 'var(--sk-amber-ink)', padding: '11px 14px', borderRadius: 9, fontSize: 13, lineHeight: 1.55 }}>
                    <strong>Short by {p.short}.</strong> This cannot be handed out yet — a class of{' '}
                    {p.quantity} with {p.received} is a worse place than one with none. The pledge
                    stays open so somebody can close it.
                  </div>
                  <label className="sk-lab" htmlFor={`top-${p.id}`}>
                    A second consignment arrived
                  </label>
                  <input id={`top-${p.id}`} className="sk-input" type="number" min={1} style={{ maxWidth: 140 }}
                    value={recv[p.id] ?? String(p.short)}
                    onChange={(e) => setRecv((r) => ({ ...r, [p.id]: e.target.value }))} />
                  <button type="button" className="sk-btn" style={{ alignSelf: 'flex-start' }}
                    onClick={() => act.mutate({ id: p.id, path: 'receive', body: { receivedQty: Number(recv[p.id] ?? p.short) } })}>
                    Record it
                  </button>
                </>
              )}

              {p.status === 'RECEIVED' && p.canDistribute && (
                <>
                  <p className="sk-muted">
                    All {p.received} received{p.surplus ? ` (${p.surplus} spare)` : ''}. Given plus
                    absent must equal {p.quantity} — children who were away are still owed theirs.
                  </p>
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <label className="sk-lab" htmlFor={`dist-${p.id}`}>Given out</label>
                      <input id={`dist-${p.id}`} className="sk-input" type="number" min={0} style={{ width: 120 }}
                        value={recv[`d${p.id}`] ?? String(p.quantity)}
                        onChange={(e) => setRecv((r) => ({ ...r, [`d${p.id}`]: e.target.value }))} />
                    </div>
                    <div>
                      <label className="sk-lab" htmlFor={`abs-${p.id}`}>Absent</label>
                      <input id={`abs-${p.id}`} className="sk-input" type="number" min={0} style={{ width: 120 }}
                        value={absent[p.id] ?? '0'}
                        onChange={(e) => setAbsent((a) => ({ ...a, [p.id]: e.target.value }))} />
                    </div>
                    <button type="button" className="sk-btn" style={{ background: 'var(--sk-brand)', borderColor: 'var(--sk-brand)', color: '#fff' }}
                      onClick={() =>
                        act.mutate({
                          id: p.id,
                          path: 'distribute',
                          body: {
                            distributedQty: Number(recv[`d${p.id}`] ?? p.quantity),
                            absentQty: Number(absent[p.id] ?? 0),
                          },
                        })
                      }>
                      Distribute
                    </button>
                  </div>
                </>
              )}

              {p.status === 'DISTRIBUTED' && (
                <>
                  <p className="sk-muted">
                    {p.distributions[0]
                      ? `${p.distributions[0].distributedQty} given out, ${p.distributions[0].absentQty} absent.`
                      : 'Handed out.'}{' '}
                    That sentence, sent back with a photograph, is the entire reason a second gift
                    ever happens.
                  </p>
                  <button type="button" className="sk-btn" style={{ alignSelf: 'flex-start', background: 'var(--sk-brand)', borderColor: 'var(--sk-brand)', color: '#fff' }}
                    onClick={() => act.mutate({ id: p.id, path: 'report', body: {} })}>
                    Send the report to the donor
                  </button>
                </>
              )}

              {(p.status === 'REPORTED' || p.status === 'DECLINED' || p.status === 'CANCELLED' || p.status === 'COUNTERED') && (
                <p className="sk-muted">
                  {p.status === 'REPORTED' && 'Reported back. Closed.'}
                  {p.status === 'DECLINED' && `Declined — ${p.declineReason}`}
                  {p.status === 'CANCELLED' && 'Cancelled.'}
                  {p.status === 'COUNTERED' && `Waiting on the donor — “${p.counterNote}”`}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CatalogueCard({
  items,
  groups,
  onChanged,
}: {
  items: GiftItemRow[];
  groups?: GiftGroups;
  onChanged: () => void;
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');

  const add = useMutation({
    mutationFn: () =>
      api.post('/manage/alumni/gift-items', {
        name: name.trim(),
        indicativeCostMinor: Math.round(Number(cost || 0) * 100),
      }),
    onSuccess: () => {
      setName('');
      setCost('');
      onChanged();
      toast.success('Added to the list.');
    },
    onError: (e) => toast.error(errText(e, 'Could not add that.')),
  });

  return (
    <section className="sk-card">
      <div className="sk-card-h">
        <h3>The wish list</h3>
        <p>
          Written by the school, never by a donor. Anything off this list arrives as a proposal
          you can redirect — which is what stops the store room filling with three hundred
          unwanted T-shirts nobody can refuse politely.
        </p>
      </div>
      <div className="sk-card-b">
        {items.length === 0 ? (
          <p className="sk-state">Nothing on the list yet. Add what the school actually needs.</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {items.map((i) => (
              <span key={i.id} className="sk-chip" style={{ cursor: 'default', opacity: i.isActive ? 1 : 0.5 }}>
                {i.name}
                <span className="sk-num" style={{ marginLeft: 6, opacity: 0.7 }}>
                  {rupees(i.indicativeCostMinor, i.currency)}
                </span>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 2, minWidth: 180 }}>
            <label className="sk-lab" htmlFor="gi-name">Item</label>
            <input id="gi-name" className="sk-input" placeholder="Sweater" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <label className="sk-lab" htmlFor="gi-cost">Indicative cost each (₹)</label>
            <input id="gi-cost" className="sk-input" type="number" min={0} placeholder="380" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
          <button type="button" className="sk-btn" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
            Add
          </button>
        </div>
        {groups && (
          <p className="sk-muted">
            Live roster a donor would see: <strong>{groups.school.headcount}</strong> children
            across {groups.sections.length} sections. Counts only — never a name, a photograph or
            a fee status.
          </p>
        )}
      </div>
    </section>
  );
}

// ─── Session requests ────────────────────────────────────────────────────────

function SessionsTab({ onChanged }: { onChanged: () => void }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [teacher, setTeacher] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [counterDate, setCounterDate] = useState<Record<string, string>>({});
  const [counterPeriod, setCounterPeriod] = useState<Record<string, string>>({});

  const sessions = useQuery({
    queryKey: ['alumni', 'sessions'],
    queryFn: () => api.get<SessionRow[]>('/manage/alumni/sessions'),
    enabled: !!host,
  });
  const teachers = useQuery({
    queryKey: ['alumni', 'teachers'],
    queryFn: () => api.get<TeacherRow[]>('/manage/teachers'),
    enabled: !!host,
    staleTime: 60_000,
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; body: unknown; asHost?: boolean }) =>
      api.post(`/manage/alumni/sessions/${v.id}/${v.asHost ? 'decide-as-host' : 'decide'}`, v.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alumni', 'sessions'] });
      onChanged();
      toast.success('Done.');
    },
    onError: (e) => toast.error(errText(e, 'That did not work.')),
  });

  if (sessions.isLoading) return <p className="sk-state">Loading requests…</p>;
  if (!sessions.data?.length) {
    return (
      <section className="sk-card">
        <div className="sk-card-b">
          <p className="sk-state">No session requests.</p>
        </div>
      </section>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {sessions.data.map((s) => {
        const picked = teacher[s.id] ?? s.accompanyingTeacherId ?? '';
        const live = s.status === 'REQUESTED' || s.status === 'COUNTERED';
        return (
          <section className="sk-card" key={s.id}>
            <div className="sk-card-h">
              <h3>{s.title}</h3>
              <span className="sk-pill" style={{ background: 'var(--sk-bg-2)', color: 'var(--sk-ink-3)' }}>{s.status}</span>
              <span className="sp" style={{ flex: 1 }} />
              {s.alumni?.trustedForStudents && (
                <span className="sk-pill" style={{ background: 'var(--sk-good-tint)', color: 'var(--sk-good)' }}>
                  trusted for students
                </span>
              )}
              <p>
                {s.alumni ? `${fullName(s.alumni)}, Class of ${s.alumni.batchYear}` : 'An alumnus'}
                {s.alumni?.profession ? ` · ${s.alumni.profession}` : ''}
                {s.alumni?.employer ? `, ${s.alumni.employer}` : ''} · asked for{' '}
                {s.requestedDate.slice(0, 10)} · {s.headcountAtBooking} children ·{' '}
                {s.mode === 'ONLINE' ? 'online' : 'in person'}
              </p>
            </div>
            <div className="sk-card-b">
              {open === s.id ? (
                <ConflictPanel id={s.id} />
              ) : (
                <button type="button" className="sk-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(s.id)}>
                  What does this cost?
                </button>
              )}

              {s.status === 'COUNTERED' && (
                <div style={{ borderLeft: '3px solid var(--sk-amber)', background: 'var(--sk-amber-tint)', color: 'var(--sk-amber-ink)', padding: '11px 14px', borderRadius: 9, fontSize: 13, lineHeight: 1.55 }}>
                  You suggested {s.counterDate?.slice(0, 10)}
                  {s.counterNote ? ` — “${s.counterNote}”` : ''}. Both slots are held until the
                  alumnus answers, so accepting cannot lose them the time.
                  <div style={{ marginTop: 9 }}>
                    <button type="button" className="sk-btn"
                      onClick={() => decide.mutate({ id: s.id, asHost: true, body: { action: 'ACCEPT' } })}>
                      Record that they accepted
                    </button>
                  </div>
                </div>
              )}

              {live && (
                <>
                  <label className="sk-lab" htmlFor={`t-${s.id}`}>
                    Who will be in the room (required)
                  </label>
                  <select id={`t-${s.id}`} className="sk-input" style={{ maxWidth: 320 }} value={picked}
                    onChange={(e) => setTeacher((t) => ({ ...t, [s.id]: e.target.value }))}>
                    <option value="">— nobody named yet —</option>
                    {teachers.data?.map((t) => (
                      <option key={t.id} value={t.id}>{fullName(t)}</option>
                    ))}
                  </select>
                  <p className="sk-muted">
                    {picked
                      ? 'Naming the teacher whose period it is means they are in the room, not free. Naming anyone else gives that teacher forty minutes back. Both cannot be true of one person.'
                      : 'Nothing below works until somebody is named. That is the safeguarding rule, enforced rather than described.'}
                  </p>
                </>
              )}

              {s.status === 'REQUESTED' && (
                <>
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <label className="sk-lab" htmlFor={`cd-${s.id}`}>Suggest another date</label>
                      <input id={`cd-${s.id}`} className="sk-input" type="date" style={{ width: 170 }}
                        min={ymdFromToday(0)}
                        value={counterDate[s.id] ?? ''}
                        onChange={(e) => setCounterDate((d) => ({ ...d, [s.id]: e.target.value }))} />
                    </div>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label className="sk-lab" htmlFor={`cp-${s.id}`}>…and which period</label>
                      <PeriodPicker
                        id={`cp-${s.id}`}
                        classSectionId={s.classSectionId}
                        date={counterDate[s.id]}
                        value={counterPeriod[s.id] ?? ''}
                        onChange={(v) => setCounterPeriod((p) => ({ ...p, [s.id]: v }))}
                      />
                    </div>
                  </div>
                  <input className="sk-input" placeholder="Why — “Class 9 has a unit test that week…”"
                    value={reason[s.id] ?? ''}
                    onChange={(e) => setReason((r) => ({ ...r, [s.id]: e.target.value }))} />
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                    <button type="button" className="sk-btn" style={{ background: 'var(--sk-good)', borderColor: 'var(--sk-good)', color: '#fff' }}
                      disabled={!picked || decide.isPending}
                      onClick={() => decide.mutate({ id: s.id, body: { action: 'ACCEPT', accompanyingTeacherId: picked } })}>
                      Accept as asked
                    </button>
                    <button type="button" className="sk-btn" style={{ background: 'var(--sk-amber-tint)', borderColor: 'var(--sk-amber)', color: 'var(--sk-amber-ink)' }}
                      disabled={!picked || !counterDate[s.id] || !counterPeriod[s.id] || decide.isPending}
                      onClick={() =>
                        decide.mutate({
                          id: s.id,
                          body: {
                            action: 'COUNTER',
                            accompanyingTeacherId: picked,
                            counterDate: counterDate[s.id],
                            counterPeriodId: counterPeriod[s.id],
                            counterNote: reason[s.id] || 'The school suggested another time.',
                          },
                        })
                      }>
                      Suggest another time
                    </button>
                    <button type="button" className="sk-btn" style={{ color: 'var(--sk-bad)' }}
                      disabled={!(reason[s.id] ?? '').trim() || decide.isPending}
                      onClick={() => decide.mutate({ id: s.id, body: { action: 'DECLINE', reason: reason[s.id] } })}>
                      Decline
                    </button>
                  </div>
                  <p className="sk-muted">
                    Whoever moves last schedules it. Accepting books it now; suggesting another
                    time and the alumnus accepting books it then — there is no third approval,
                    because proposing a time <em>is</em> approving it.
                  </p>
                </>
              )}

              {s.status === 'SCHEDULED' && (
                <div style={{ borderLeft: '3px solid var(--sk-good)', background: 'var(--sk-good-tint)', padding: '11px 14px', borderRadius: 9, fontSize: 13, lineHeight: 1.55 }}>
                  Scheduled for {s.scheduledDate?.slice(0, 10)}. Written into the timetable — the
                  displaced teacher&rsquo;s own week now reads <em>free</em> for that period.
                </div>
              )}
              {s.status === 'DECLINED' && <p className="sk-muted">Declined — {s.declineReason}</p>}
              {s.status === 'CANCELLED' && <p className="sk-muted">Cancelled. {s.declineReason}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ConflictPanel({ id }: { id: string }) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const q = useQuery({
    queryKey: ['alumni', 'conflicts', id],
    queryFn: () => api.get<SessionConflicts>(`/manage/alumni/sessions/${id}/conflicts`),
    enabled: !!host,
  });
  if (q.isLoading) return <p className="sk-state">Checking…</p>;
  if (!q.data) return <p className="sk-state">Could not read the timetable.</p>;
  const c = q.data;
  return (
    <div style={{ background: 'var(--sk-bg-2)', borderRadius: 11, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Line ok>
        {c.displaced
          ? `That class gives up ${c.displaced.subjectName ?? 'a lesson'}${c.displaced.teacherName ? ` with ${c.displaced.teacherName}` : ''}.`
          : 'Nothing is timetabled then — no lesson is displaced.'}
      </Line>
      {c.examsWithinAWeek.length > 0 ? (
        <Line ok={false}>
          {c.examsWithinAWeek.map((e) => `${e.title} on ${e.on}`).join(', ')} — within a week. Your call.
        </Line>
      ) : (
        <Line ok>No exam for that class within the week.</Line>
      )}
      <Line ok>This class has had {c.sessionsThisClass} guest session{c.sessionsThisClass === 1 ? '' : 's'}.</Line>
      {c.siblingSections.length > 0 && (
        <Line ok>
          Least visited elsewhere: {c.siblingSections.slice(0, 3).map((s) => `${s.label} (${s.sessions})`).join(', ')}.
        </Line>
      )}
    </div>
  );
}

function Line({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 10, fontSize: 13, lineHeight: 1.5, color: 'var(--sk-ink-2)' }}>
      <span style={{ color: ok ? 'var(--sk-good)' : 'var(--sk-amber-ink)', fontWeight: 700 }}>{ok ? '✓' : '!'}</span>
      <span>{children}</span>
    </div>
  );
}

/** Only offers periods the API says are actually free on that date. Letting the
 *  office suggest a period that is itself taken is how a counter-offer becomes a
 *  second round of the same argument. */
function PeriodPicker({
  id,
  classSectionId,
  date,
  value,
  onChange,
}: {
  id: string;
  classSectionId: string;
  date?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const q = useQuery({
    queryKey: ['alumni', 'slots', classSectionId, date],
    queryFn: () =>
      api.get<SlotsResult>(
        `/manage/alumni/slots?classSectionId=${classSectionId}&from=${date}&to=${date}`,
      ),
    enabled: !!host && !!date,
  });
  const free = useMemo(() => (q.data?.slots ?? []).filter((s) => s.state === 'FREE'), [q.data]);

  if (!date) return <select id={id} className="sk-input" disabled><option>Pick a date first</option></select>;
  if (q.isLoading) return <select id={id} className="sk-input" disabled><option>Checking…</option></select>;
  if (free.length === 0)
    return <select id={id} className="sk-input" disabled><option>Nothing free that day</option></select>;

  return (
    <select id={id} className="sk-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— pick a period —</option>
      {free.map((s) => (
        <option key={s.periodId} value={s.periodId}>
          {s.periodLabel} · {s.startTime}–{s.endTime}
          {s.subjectName ? ` · ${s.subjectName}` : ''}
        </option>
      ))}
    </select>
  );
}
