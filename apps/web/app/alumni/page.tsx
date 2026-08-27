'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useHost } from '@/components/use-host';
import '../sk-theme.css';

/**
 * The alumnus's side of Homecoming, on the school's own site at /alumni.
 *
 * Not a separate app and not behind a login box. The front of this page is
 * PUBLIC and indexable, deliberately: a password wall means a search engine
 * cannot reach "Class of 1998", and the alumnus in Dubai never finds himself.
 * That public front is the entire recovery engine.
 *
 * Identity is asked for at the ACTION, not the door. You read a batch page as a
 * stranger; the moment you want to do something, the link you were sent is what
 * proves who you are. There is no password anywhere in this file.
 */

const SESSION_KEY = 'sk_alumni_session';

interface BatchIndexRow { batchYear: number; found: number; registerStrength: number }
interface DirectoryRow {
  id: string; name: string; batchYear: number; city: string | null;
  profession: string | null; employer: string | null; collegeName: string | null;
  photoAssetId: string | null; isMentor: boolean; email: string | null; phone: string | null;
}
interface BatchPage {
  batchYear: number; found: number; registerStrength: number;
  coverage: number | null; stillMissing: number; alumni: DirectoryRow[];
}
interface Me {
  id: string; firstName: string; lastName: string; batchYear: number;
  city: string | null; profession: string | null; employer: string | null;
  collegeName: string | null; phone: string | null; isMentor: boolean;
  status: string; trustedForStudents: boolean; privacy: Record<string, string> | null;
}
interface GiftGroup { scopeKind: string; gradeId?: string; classSectionId?: string; label: string; headcount: number }
interface GiftGroups { school: GiftGroup; grades: GiftGroup[]; sections: GiftGroup[] }
interface GiftItem { id: string; name: string; unit: string; indicativeCostMinor: number; currency: string }

const PRIVACY_LEVELS = ['PUBLIC', 'ALUMNI', 'BATCH', 'HIDDEN'] as const;
const PRIVACY_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'name', label: 'Name and batch year' },
  { key: 'photo', label: 'Photograph' },
  { key: 'city', label: 'City', hint: 'The most-used filter in the directory' },
  { key: 'work', label: 'Profession and employer' },
  { key: 'college', label: 'College and course' },
  { key: 'phone', label: 'Phone and email', hint: 'Closed by default. Nothing opens this but you.' },
];

const rupees = (m: number) => `₹${(m / 100).toLocaleString('en-IN')}`;

/**
 * A tiny client of its own, deliberately NOT the shared `useApi`.
 *
 * The shared ApiClient is bound to the school JWT in the zustand auth store and
 * calls `clear()` on any 401 — so routing an alumnus's call through it would
 * sign a school admin out of their own console the first time an alumni link
 * expired. The alumni door has no refresh flow, no zustand slice and a
 * different token entirely, so it gets fifteen lines of its own rather than a
 * flag threaded through shared code that every portal depends on.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

class AlumniApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function call<T>(
  host: string | undefined,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: { body?: unknown; session?: string | null } = {},
): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (host) {
    // Both, for the same reason lib/api.ts sends both: the API prefers
    // X-Skoolos-Host, and X-Forwarded-Host is what an ingress leaves behind.
    headers.set('X-Forwarded-Host', host);
    headers.set('X-Skoolos-Host', host);
  }
  if (opts.session) headers.set('Authorization', `Bearer ${opts.session}`);
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new AlumniApiError(
      typeof parsed.message === 'string' ? parsed.message : 'Something went wrong',
      res.status,
      typeof parsed.code === 'string' ? parsed.code : undefined,
    );
  }
  return parsed as T;
}

const errText = (e: unknown, f: string) => (e instanceof AlumniApiError ? e.message : f);


/** Reads the session the claim link minted. localStorage, not a cookie the page
 *  writes itself, because this file is static and the value is per-device. */
function readSession(): string | null {
  try {
    return window.localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export default function AlumniSitePage() {
  const host = useHost();
  const qc = useQueryClient();
  const [session, setSession] = useState<string | null>(null);
  /** Held between "found it in the hash" and "the host is known". */
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  /** A single-use token must be spent once, even under StrictMode double-invoke. */
  const claimedRef = useRef(false);
  const [tab, setTab] = useState<'batches' | 'directory' | 'give' | 'sessions' | 'me'>('batches');
  const [openYear, setOpenYear] = useState<number | null>(null);

  // The claim link lands as /alumni#claim=<token>. Read once, redeem, and strip
  // it from the address bar immediately — a token left in the URL ends up in the
  // Referer header of every outbound link and in whatever gets pasted into a
  // group chat when somebody shares "the page".
  const redeem = useMutation({
    mutationFn: (token: string) =>
      call<{ session: string; alumni: { firstName: string } }>(host, 'POST', '/alumni/claim', { body: { token } }),
    onSuccess: (r) => {
      try { window.localStorage.setItem(SESSION_KEY, r.session); } catch { /* private mode */ }
      setSession(r.session);
      setTab('me');
      toast.success(`Welcome back, ${r.alumni.firstName}.`);
    },
    onError: (e) => toast.error(errText(e, 'That link is not valid any more. Ask the school for a new one.')),
  });

  /**
   * Step one, on mount: lift the token OUT of the URL and hold it.
   *
   * The hash is stripped immediately — a token left in the address bar ends up
   * in the Referer header of every outbound link and in whatever gets pasted
   * into a group chat when somebody shares "the page".
   */
  useEffect(() => {
    setSession(readSession());
    const m = /[#&]claim=([^&]+)/.exec(window.location.hash);
    if (m?.[1]) {
      setPendingToken(decodeURIComponent(m[1]));
      window.history.replaceState(null, '', window.location.pathname);
    }
    // Once, on mount. Re-running would re-read a hash that is already gone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Step two: redeem, but ONLY once the host is known.
   *
   * `useHost()` reads window.location.host in its own mount effect, so on the
   * very first render it is undefined. Redeeming there sends no Host header,
   * the API cannot resolve the tenant, and the answer is "No tenant context" —
   * which burns nothing, but means the claim link simply never works. This is
   * the same fault the Exam Hall tab shipped with; the repo's host guard did
   * not catch it here because that guard reads `useQuery` bodies under
   * `app/app`, and this is a mutation in an effect under `app/alumni`.
   *
   * The ref makes it fire exactly once. The token is single-use: a second
   * attempt would spend it and land the alumnus on an error.
   */
  useEffect(() => {
    if (!host || !pendingToken || claimedRef.current) return;
    claimedRef.current = true;
    redeem.mutate(pendingToken);
    setPendingToken(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, pendingToken]);

  const me = useQuery({
    queryKey: ['alumni-site', 'me', session],
    queryFn: () => call<Me>(host, 'GET', '/alumni/me', { session }),
    enabled: !!host && !!session,
    retry: false,
  });

  // A session that no longer resolves — the office un-verified them, or ninety
  // days passed — is dropped rather than left to 401 on every screen.
  useEffect(() => {
    if (me.isError && session) {
      try { window.localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
      setSession(null);
    }
  }, [me.isError, session]);

  const signedIn = !!session && !!me.data;

  return (
    <div className="skosx" style={{ background: 'var(--sk-paper)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '34px 20px 80px' }}>
        <header className="sk-pagehead">
          <div>
            <h1>Alumni</h1>
            <p>
              {signedIn
                ? `Signed in as ${me.data!.firstName} ${me.data!.lastName}, Class of ${me.data!.batchYear}.`
                : 'Find your year, find yourself, and tell us where you got to. No password — the school sends you a link.'}
            </p>
          </div>
        </header>

        <nav className="sk-tabs" style={{ marginBottom: 20 }} aria-label="Alumni sections">
          {([
            ['batches', 'Batches'],
            ['directory', 'Directory'],
            ['give', 'Give'],
            ['sessions', 'Sessions'],
            ['me', 'My profile'],
          ] as const).map(([id, label]) => {
            const needsSession = id !== 'batches';
            const locked = needsSession && !signedIn;
            const trustedOnly = id === 'sessions' && signedIn && !me.data!.trustedForStudents;
            return (
              <button
                key={id}
                type="button"
                className="sk-tab"
                aria-current={tab === id ? 'page' : undefined}
                disabled={locked || trustedOnly}
                title={
                  locked
                    ? 'Open the link the school sent you'
                    : trustedOnly
                      ? 'The school has not cleared you to work with students'
                      : undefined
                }
                style={{
                  ...(tab === id ? { borderBottomColor: 'var(--sk-brand)', color: 'var(--sk-brand-2)' } : {}),
                  ...(locked || trustedOnly ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
                }}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            );
          })}
        </nav>

        {!signedIn && tab !== 'batches' && (
          <Notice>
            Open the link the school sent you on WhatsApp and this page will know who you are.
            There is nothing to remember and no password to reset.
          </Notice>
        )}

        {tab === 'batches' && (
          <Batches host={host} openYear={openYear} setOpenYear={setOpenYear} />
        )}
        {tab === 'directory' && signedIn && <Directory host={host} session={session} />}
        {tab === 'give' && signedIn && <Give host={host} session={session} qc={qc} />}
        {tab === 'sessions' && signedIn && me.data!.trustedForStudents && (
          <Sessions host={host} session={session} qc={qc} />
        )}
        {tab === 'me' && signedIn && (
          <Profile host={host} session={session} me={me.data!} qc={qc} onSignOut={() => {
            call(host, 'POST', '/alumni/me/sign-out', { session }).catch(() => undefined);
            try { window.localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
            setSession(null);
            setTab('batches');
          }} />
        )}
      </div>
    </div>
  );
}

function Notice({ children, tone = 'brand' }: { children: React.ReactNode; tone?: 'brand' | 'amber' | 'good' }) {
  const c = tone === 'amber'
    ? { border: 'var(--sk-amber)', bg: 'var(--sk-amber-tint)', fg: 'var(--sk-amber-ink)' }
    : tone === 'good'
      ? { border: 'var(--sk-good)', bg: 'var(--sk-good-tint)', fg: 'var(--sk-ink-2)' }
      : { border: 'var(--sk-brand)', bg: 'var(--sk-brand-tint)', fg: 'var(--sk-ink-2)' };
  return (
    <div style={{
      borderLeft: `3px solid ${c.border}`, background: c.bg, color: c.fg,
      borderRadius: '0 9px 9px 0', padding: '12px 15px', fontSize: 13.5, lineHeight: 1.55,
      marginBottom: 16,
    }}>
      {children}
    </div>
  );
}

/* ─── Batches — the public half ──────────────────────────────────────────── */

function Batches({
  host, openYear, setOpenYear,
}: {
  host: string | undefined;
  openYear: number | null; setOpenYear: (y: number | null) => void;
}) {
  const index = useQuery({
    queryKey: ['alumni-site', 'batches'],
    queryFn: () => call<BatchIndexRow[]>(host, 'GET', '/alumni/batches'),
    enabled: !!host,
  });
  const page = useQuery({
    queryKey: ['alumni-site', 'batch', openYear],
    queryFn: () => call<BatchPage>(host, 'GET', `/alumni/batches/${openYear}`),
    enabled: !!host && openYear !== null,
  });

  if (index.isLoading) return <p className="sk-state">Loading…</p>;
  if (!index.data?.length) {
    return (
      <section className="sk-card"><div className="sk-card-b">
        <p className="sk-state">No batches recorded yet.</p>
      </div></section>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Notice>
        <strong>This page is public on purpose.</strong> Anyone can read it without signing in —
        which is how somebody who left in 1998 finds themselves from a search engine. Nothing on
        it is a contact detail unless its owner published one.
      </Notice>

      <section className="sk-card">
        <div className="sk-card-h"><h3>Every year</h3></div>
        <div className="sk-card-b">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {index.data.map((b) => (
              <button
                key={b.batchYear}
                type="button"
                className="sk-chip"
                aria-pressed={openYear === b.batchYear}
                style={openYear === b.batchYear
                  ? { borderColor: 'var(--sk-brand)', background: 'var(--sk-brand-tint)', color: 'var(--sk-brand-2)' }
                  : undefined}
                onClick={() => setOpenYear(openYear === b.batchYear ? null : b.batchYear)}
              >
                {b.batchYear}
                <span className="sk-num" style={{ marginLeft: 6, opacity: 0.7 }}>
                  {b.found}{b.registerStrength ? `/${b.registerStrength}` : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {openYear !== null && (
        <section className="sk-card">
          <div className="sk-card-h">
            <h3>Class of {openYear}</h3>
            {page.data && (
              <p>
                {page.data.coverage === null
                  ? `${page.data.found} found · the school has not recorded how many were in that year`
                  : `${page.data.found} of ${page.data.registerStrength} found — help us find the other ${page.data.stillMissing}`}
              </p>
            )}
          </div>
          <div className="sk-card-b">
            {page.isLoading && <p className="sk-state">Loading…</p>}
            {page.data?.coverage !== null && page.data && (
              <div className="sk-progress" style={{ marginTop: 0 }}>
                <div className="sk-progress-fill" style={{ width: `${page.data.coverage}%` }} />
              </div>
            )}
            {page.data?.alumni.length === 0 && (
              <p className="sk-state">Nobody from this year has been found yet.</p>
            )}
            {page.data?.alumni.map((a) => (
              <div className="sk-row" key={a.id}>
                <div className="badge" style={{ background: 'var(--sk-brand)' }}>
                  {a.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}
                </div>
                <div className="sp">
                  <div className="nm">{a.name}</div>
                  <div className="meta">
                    {[a.city, a.profession, a.employer].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                {a.isMentor && (
                  <span className="sk-pill" style={{ background: 'var(--sk-good-tint)', color: 'var(--sk-good)' }}>
                    will mentor
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ─── Directory ──────────────────────────────────────────────────────────── */

function Directory({
  host, session,
}: { host: string | undefined; session: string | null }) {
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [mentor, setMentor] = useState(false);

  const dir = useQuery({
    queryKey: ['alumni-site', 'directory', q, city, mentor],
    queryFn: () => {
      const p = new URLSearchParams();
      if (q) p.set('q', q);
      if (city) p.set('city', city);
      if (mentor) p.set('mentor', 'true');
      return call<{ rows: DirectoryRow[]; total: number }>(
        host, 'GET', `/alumni/me/directory?${p.toString()}`, { session },
      );
    },
    enabled: !!host,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="sk-card"><div className="sk-card-b">
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <input className="sk-input" style={{ flex: 2, minWidth: 160 }} placeholder="Name or profession…"
            value={q} onChange={(e) => setQ(e.target.value)} />
          <input className="sk-input" style={{ flex: 1, minWidth: 130 }} placeholder="City"
            value={city} onChange={(e) => setCity(e.target.value)} />
          <button type="button" className="sk-btn"
            style={mentor ? { background: 'var(--sk-brand)', borderColor: 'var(--sk-brand)', color: '#fff' } : undefined}
            onClick={() => setMentor((m) => !m)}>
            Will mentor
          </button>
        </div>
        <p className="sk-muted">
          <b>{dir.data?.total ?? 0}</b> verified alumni. What you see, each person chose to show —
          and contact details stay hidden unless they opened them.
        </p>
      </div></section>

      <section className="sk-card"><div className="sk-card-b">
        {dir.isLoading && <p className="sk-state">Loading…</p>}
        {dir.data?.rows.length === 0 && <p className="sk-state">Nobody matches that.</p>}
        {dir.data?.rows.map((a) => (
          <div className="sk-row" key={a.id}>
            <div className="badge" style={{ background: 'var(--sk-brand)' }}>
              {a.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}
            </div>
            <div className="sp">
              <div className="nm">
                {a.name}{' '}
                <span className="sk-pill" style={{ background: 'var(--sk-bg-2)', color: 'var(--sk-ink-3)' }}>
                  {a.batchYear}
                </span>
              </div>
              <div className="meta">{[a.city, a.profession, a.employer].filter(Boolean).join(' · ') || '—'}</div>
              {(a.phone || a.email) && (
                <div className="meta" style={{ color: 'var(--sk-brand-2)' }}>
                  {[a.phone, a.email].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          </div>
        ))}
      </div></section>

      <Notice>
        <strong>Students cannot open this screen at all.</strong> Not a filtered version of it — it
        does not exist in their portal. Adults and children never browse each other.
      </Notice>
    </div>
  );
}

/* ─── Give ───────────────────────────────────────────────────────────────── */

function Give({
  host, session, qc,
}: {
  host: string | undefined;
  session: string | null; qc: ReturnType<typeof useQueryClient>;
}) {
  const [group, setGroup] = useState<GiftGroup | null>(null);
  const [itemId, setItemId] = useState<string>('');
  const [mode, setMode] = useState<'SUPPLY' | 'FUND'>('SUPPLY');
  const [ded, setDed] = useState('');

  const groups = useQuery({
    queryKey: ['alumni-site', 'gift-groups'],
    queryFn: () => call<GiftGroups>(host, 'GET', '/alumni/me/gift-groups', { session }),
    enabled: !!host,
  });
  const items = useQuery({
    queryKey: ['alumni-site', 'gift-items'],
    queryFn: () => call<GiftItem[]>(host, 'GET', '/alumni/me/gift-items', { session }),
    enabled: !!host,
  });

  const pledge = useMutation({
    mutationFn: () =>
      call(host, 'POST', '/alumni/me/pledges', {
        session,
        body: {
          scopeKind: group!.scopeKind,
          gradeId: group!.gradeId,
          classSectionId: group!.classSectionId,
          giftItemId: itemId || undefined,
          mode,
          dedicationKind: ded.trim() ? 'IN_MEMORY_OF' : 'NONE',
          dedicationText: ded.trim() || undefined,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alumni-site', 'my-pledges'] });
      toast.success('Sent to the office. Nothing is charged or shipped until they accept.');
    },
    onError: (e) => toast.error(errText(e, 'Could not send that.')),
  });

  const all = useMemo(
    () => (groups.data ? [groups.data.school, ...groups.data.grades, ...groups.data.sections] : []),
    [groups.data],
  );
  const item = items.data?.find((i) => i.id === itemId);
  const qty = group?.headcount ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="sk-card">
        <div className="sk-card-h">
          <h3>1 · Who is it for</h3>
          <p>Live from the register. Counts only — never a child’s name, photograph or fee status.</p>
        </div>
        <div className="sk-card-b">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {all.map((g) => {
              const on = group?.label === g.label;
              return (
                <button key={g.label} type="button" className="sk-chip" aria-pressed={on}
                  style={on ? { borderColor: 'var(--sk-brand)', background: 'var(--sk-brand-tint)', color: 'var(--sk-brand-2)' } : undefined}
                  onClick={() => setGroup(on ? null : g)}>
                  {g.label}
                  <span className="sk-num" style={{ marginLeft: 6, opacity: 0.7 }}>{g.headcount}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="sk-card">
        <div className="sk-card-h">
          <h3>2 · What</h3>
          <p>Written by the school. Anything off this list becomes a proposal the office can redirect.</p>
        </div>
        <div className="sk-card-b">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {items.data?.map((i) => (
              <button key={i.id} type="button" className="sk-chip" aria-pressed={itemId === i.id}
                style={itemId === i.id ? { borderColor: 'var(--sk-brand)', background: 'var(--sk-brand-tint)', color: 'var(--sk-brand-2)' } : undefined}
                onClick={() => setItemId(itemId === i.id ? '' : i.id)}>
                {i.name}
                <span className="sk-num" style={{ marginLeft: 6, opacity: 0.7 }}>{rupees(i.indicativeCostMinor)}</span>
              </button>
            ))}
            {items.data?.length === 0 && <p className="sk-state">The school has not published a list yet.</p>}
          </div>
        </div>
      </section>

      <section className="sk-card">
        <div className="sk-card-h"><h3>3 · How it arrives</h3></div>
        <div className="sk-card-b">
          <div className="sk-seg">
            <button type="button" data-tone="amber" aria-pressed={mode === 'SUPPLY'} onClick={() => setMode('SUPPLY')}>
              I will send the goods
            </button>
            <button type="button" aria-pressed={mode === 'FUND'} onClick={() => setMode('FUND')}>
              I will pay, school buys
            </button>
          </div>
          {mode === 'SUPPLY' ? (
            <Notice tone="amber">
              <strong>No money changes hands here.</strong> You commit to a quantity and a date; the
              office records what actually arrives.
              <br /><br />
              <strong>Before you commit:</strong> gifts in kind are generally not eligible for 80G
              relief. If you need a certificate, choose <em>I will pay</em> instead.
            </Notice>
          ) : (
            <Notice>
              {item && qty ? <><b>{rupees(item.indicativeCostMinor * qty)}</b> — </> : null}
              on the school’s own payment rail. The school is the merchant, never us, and the
              receipt comes from them.
            </Notice>
          )}
          <label className="sk-lab" htmlFor="ded">Dedication — optional</label>
          <input id="ded" className="sk-input" placeholder="In memory of Shri R. K. Meena, my father"
            value={ded} onChange={(e) => setDed(e.target.value)} />
        </div>
      </section>

      <section className="sk-card">
        <div className="sk-card-h"><h3>Your pledge</h3></div>
        <div className="sk-card-b">
          {!group || !itemId ? (
            <p className="sk-state">Pick a group and something from the list.</p>
          ) : (
            <>
              <p style={{ fontFamily: 'var(--sk-serif)', fontSize: 26, fontWeight: 650, letterSpacing: '-0.02em' }}>
                {qty} × {item?.name.toLowerCase()}
              </p>
              <p className="sk-muted">
                for <b style={{ color: 'var(--sk-ink)' }}>{group.label}</b> — {qty} children. The
                quantity <b>is</b> the headcount and is not something you can edit: a class of {qty}{' '}
                with fewer than {qty} is a worse place than one with none.
              </p>
              <button type="button" className="sk-btn"
                style={{ background: 'var(--sk-brand)', borderColor: 'var(--sk-brand)', color: '#fff', alignSelf: 'flex-start' }}
                disabled={pledge.isPending} onClick={() => pledge.mutate()}>
                {pledge.isPending ? 'Sending…' : `Pledge ${qty} ${item?.name.toLowerCase()}`}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/* ─── Sessions ───────────────────────────────────────────────────────────── */

interface MySession {
  id: string; title: string; status: string; requestedDate: string;
  counterDate: string | null; counterNote: string | null; scheduledDate: string | null;
}

function Sessions({
  host, session, qc,
}: {
  host: string | undefined;
  session: string | null; qc: ReturnType<typeof useQueryClient>;
}) {
  const mine = useQuery({
    queryKey: ['alumni-site', 'my-sessions'],
    queryFn: () => call<MySession[]>(host, 'GET', '/alumni/me/sessions', { session }),
    enabled: !!host,
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; action: string; reason?: string }) =>
      call(host, 'POST', `/alumni/me/sessions/${v.id}/decide`, { session, body: { action: v.action, reason: v.reason } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alumni-site', 'my-sessions'] });
      toast.success('Done.');
    },
    onError: (e) => toast.error(errText(e, 'That did not work.')),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Notice tone="good">
        The school has cleared you to work with students. A named member of staff is in the room for
        every session, and any follow-up questions come to you in writing through the school.
      </Notice>

      {mine.isLoading && <p className="sk-state">Loading…</p>}
      {mine.data?.length === 0 && (
        <section className="sk-card"><div className="sk-card-b">
          <p className="sk-state">
            You have no sessions yet. The school will invite you, or you can ask the office for a slot.
          </p>
        </div></section>
      )}

      {mine.data?.map((s) => (
        <section className="sk-card" key={s.id}>
          <div className="sk-card-h">
            <h3>{s.title}</h3>
            <span className="sk-pill" style={{ background: 'var(--sk-bg-2)', color: 'var(--sk-ink-3)' }}>{s.status}</span>
          </div>
          <div className="sk-card-b">
            {s.status === 'COUNTERED' && (
              <>
                <Notice tone="amber">
                  <strong>The school suggested {s.counterDate?.slice(0, 10)}.</strong>
                  {s.counterNote ? ` “${s.counterNote}”` : ''}
                  <br />Both slots are held until you answer, so accepting cannot lose you the time.
                </Notice>
                <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
                  <button type="button" className="sk-btn"
                    style={{ background: 'var(--sk-good)', borderColor: 'var(--sk-good)', color: '#fff' }}
                    onClick={() => decide.mutate({ id: s.id, action: 'ACCEPT' })}>
                    Accept that time
                  </button>
                  <button type="button" className="sk-btn" style={{ color: 'var(--sk-bad)' }}
                    onClick={() => decide.mutate({ id: s.id, action: 'DECLINE', reason: 'Cannot make that date' })}>
                    Cannot do it
                  </button>
                </div>
              </>
            )}
            {s.status === 'REQUESTED' && (
              <p className="sk-muted">With the office. They can accept it, or suggest another time.</p>
            )}
            {s.status === 'SCHEDULED' && (
              <Notice tone="good">
                <strong>Confirmed for {s.scheduledDate?.slice(0, 10)}.</strong> You are on the visitor
                register, and a member of staff will meet you.
              </Notice>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ─── Profile ────────────────────────────────────────────────────────────── */

function Profile({
  host, session, me, qc, onSignOut,
}: {
  host: string | undefined;
  session: string | null; me: Me;
  qc: ReturnType<typeof useQueryClient>; onSignOut: () => void;
}) {
  const [draft, setDraft] = useState({
    phone: me.phone ?? '', city: me.city ?? '', profession: me.profession ?? '',
    employer: me.employer ?? '', collegeName: me.collegeName ?? '', isMentor: me.isMentor,
  });
  const [privacy, setPrivacy] = useState<Record<string, string>>(
    (me.privacy as Record<string, string>) ?? {},
  );

  const save = useMutation({
    mutationFn: () => call(host, 'PUT', '/alumni/me', { session, body: { ...draft, privacy } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alumni-site', 'me'] });
      toast.success('Saved.');
    },
    onError: (e) => toast.error(errText(e, 'Could not save that.')),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="sk-card">
        <div className="sk-card-h"><h3>Where you got to</h3>
          <p>Only you can change this, and only you decide who sees each line.</p></div>
        <div className="sk-card-b">
          {([
            ['city', 'City'], ['profession', 'Profession'], ['employer', 'Employer'],
            ['collegeName', 'College'], ['phone', 'Phone'],
          ] as const).map(([k, label]) => (
            <div key={k}>
              <label className="sk-lab" htmlFor={`f-${k}`}>{label}</label>
              <input id={`f-${k}`} className="sk-input" value={draft[k]}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
            </div>
          ))}
          <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13.5, marginTop: 4 }}>
            <input type="checkbox" checked={draft.isMentor}
              onChange={(e) => setDraft((d) => ({ ...d, isMentor: e.target.checked }))} />
            I am willing to mentor
          </label>
        </div>
      </section>

      <section className="sk-card">
        <div className="sk-card-h"><h3>Who can see what</h3>
          <p>Every field starts closed. You open each one deliberately, and can shut it again.</p></div>
        <div className="sk-card-b">
          {PRIVACY_FIELDS.map((f) => (
            <div key={f.key} className="sk-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div className="sp">
                <div className="nm">{f.label}</div>
                {f.hint && <div className="meta">{f.hint}</div>}
              </div>
              <div className="sk-seg" style={{ flex: 'none' }}>
                {PRIVACY_LEVELS.map((lv) => (
                  <button key={lv} type="button" aria-pressed={(privacy[f.key] ?? 'HIDDEN') === lv}
                    data-tone={lv === 'PUBLIC' ? 'good' : lv === 'HIDDEN' ? 'bad' : undefined}
                    onClick={() => setPrivacy((p) => ({ ...p, [f.key]: lv }))}>
                    {lv === 'ALUMNI' ? 'Alumni' : lv === 'BATCH' ? 'My batch' : lv === 'PUBLIC' ? 'Public' : 'Hidden'}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button type="button" className="sk-btn"
            style={{ background: 'var(--sk-brand)', borderColor: 'var(--sk-brand)', color: '#fff', alignSelf: 'flex-start' }}
            disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      <section className="sk-card">
        <div className="sk-card-h"><h3>How you got in</h3></div>
        <div className="sk-card-b">
          <p className="sk-muted">
            You have <b style={{ color: 'var(--sk-ink)' }}>no password</b>. You arrived by a personal
            link the school sent you, and this device stays known for ninety days. If you lose it,
            ask the office to send another — that is the whole of account recovery.
          </p>
          <button type="button" className="sk-btn" style={{ alignSelf: 'flex-start' }} onClick={onSignOut}>
            Sign out on this device
          </button>
        </div>
      </section>
    </div>
  );
}
