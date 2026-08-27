'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The alumni wing, on the school's OWN public site.
 *
 * This is a section of PublicSite, not a page of its own, and that is the whole
 * point: it inherits the school's chosen theme (`--ps1`/`--ps2`, the `ps-*`
 * classes, its fonts and its section shapes) exactly as Academics and Connect
 * do. The first version of this screen was built in the ADMIN portal theme —
 * indigo on cream, `sk-*` classes — which is right for the office console and
 * wrong for a page a parent or an old pupil lands on from a search engine. Two
 * different products should not appear on one domain.
 *
 * The front of it is public on purpose. A password wall means a search engine
 * cannot index "Class of 1998", and the alumnus in Dubai never finds himself.
 * Identity is asked for at the ACTION, never at the door.
 */

const SESSION_KEY = 'sk_alumni_session';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface BatchIndexRow { batchYear: number; found: number; registerStrength: number }
interface DirRow {
  id: string; name: string; batchYear: number; city: string | null;
  profession: string | null; employer: string | null; collegeName: string | null;
  isMentor: boolean; email: string | null; phone: string | null;
}
interface BatchPage {
  batchYear: number; found: number; registerStrength: number;
  coverage: number | null; stillMissing: number; alumni: DirRow[];
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

type Tab = 'batches' | 'directory' | 'give' | 'giving' | 'profile';
type TabId = Tab;

/** Mirrors giftJourney()/giftStatusLabel() on the server. The server sends the
 *  journey and the labels with every pledge, so this is only the fallback for
 *  a row that predates them — never a second implementation of the rules. */
const GIFT_STEP_WORDS: Record<string, string> = {
  PROPOSED: 'Offered',
  ACCEPTED: 'Accepted',
  PICKUP_REQUESTED: 'Collection arranged',
  PICKED_UP: 'On its way',
  RECEIVED: 'Arrived',
  PURCHASED: 'Bought',
  DISTRIBUTED: 'Given out',
  REPORTED: 'Reported back',
  COUNTERED: 'School suggested another',
  DECLINED: 'Not taken up',
  CANCELLED: 'Cancelled',
};

const PRIVACY_LEVELS = ['PUBLIC', 'ALUMNI', 'BATCH', 'HIDDEN'] as const;
const PRIVACY_FIELDS: { key: string; label: string }[] = [
  { key: 'name', label: 'Name and batch year' },
  { key: 'photo', label: 'Photograph' },
  { key: 'city', label: 'City' },
  { key: 'work', label: 'Profession and employer' },
  { key: 'college', label: 'College and course' },
  { key: 'phone', label: 'Phone and email' },
];

const rupees = (m: number) => `₹${(m / 100).toLocaleString('en-IN')}`;

/** This section's own tiny client. Deliberately not the shared ApiClient: that
 *  one is bound to the school JWT and calls clear() on any 401, so an expired
 *  alumni link would sign a logged-in admin out of their own console. */
async function call<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: { body?: unknown; session?: string | null } = {},
): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  // The browser is already ON the school's host, so the API resolves the tenant
  // from the forwarded host. No header juggling and no race with a hook.
  if (typeof window !== 'undefined') {
    headers.set('X-Forwarded-Host', window.location.host);
    headers.set('X-Skoolos-Host', window.location.host);
  }
  if (opts.session) headers.set('Authorization', `Bearer ${opts.session}`);
  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) throw new Error(typeof parsed.message === 'string' ? parsed.message : 'Something went wrong');
  return parsed as T;
}

export default function AlumniSection({ schoolName }: { schoolName: string }) {
  const [tab, setTab] = useState<Tab>('batches');
  const [session, setSession] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const claimedRef = useRef(false);

  /**
   * The claim link arrives as /alumni#claim=<token>.
   *
   * The hash is stripped before anything else — a token left in the address bar
   * reaches the Referer header of every outbound link on the page. The ref makes
   * the redemption fire exactly once: the token is single-use, and a second
   * attempt would spend it and land the alumnus on an error.
   */
  useEffect(() => {
    try {
      setSession(window.localStorage.getItem(SESSION_KEY));
    } catch { /* private mode */ }
    const m = /[#&]claim=([^&]+)/.exec(window.location.hash);
    if (!m?.[1] || claimedRef.current) return;
    claimedRef.current = true;
    const token = decodeURIComponent(m[1]);
    window.history.replaceState(null, '', window.location.pathname);
    call<{ session: string; alumni: { firstName: string } }>('POST', '/alumni/claim', { body: { token } })
      .then((r) => {
        try { window.localStorage.setItem(SESSION_KEY, r.session); } catch { /* ignore */ }
        setSession(r.session);
        setTab('profile');
        setNote({ kind: 'ok', text: `Welcome back, ${r.alumni.firstName}.` });
      })
      .catch((e: Error) =>
        setNote({ kind: 'err', text: e.message || 'That link is not valid any more. Ask the school for a new one.' }),
      );
  }, []);

  // A session that no longer resolves — un-verified, or ninety days gone — is
  // dropped rather than left to fail on every screen.
  useEffect(() => {
    if (!session) { setMe(null); return; }
    call<Me>('GET', '/alumni/me', { session })
      .then(setMe)
      .catch(() => {
        try { window.localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
        setSession(null);
        setMe(null);
      });
  }, [session]);

  const signedIn = !!session && !!me;

  const TABS: { id: Tab; label: string; needsSession: boolean }[] = [
    { id: 'batches', label: 'Every year', needsSession: false },
    { id: 'directory', label: 'Directory', needsSession: true },
    { id: 'give', label: 'Give', needsSession: true },
    { id: 'giving', label: 'My giving', needsSession: true },
    { id: 'profile', label: 'My profile', needsSession: true },
  ];

  return (
    <section className="max-w-6xl mx-auto px-6 py-14">
      {note && (
        <div
          className="ps-panel p-4 mb-6 text-sm"
          role="status"
          style={{
            borderLeft: `3px solid ${note.kind === 'ok' ? 'var(--ps2)' : '#c4453f'}`,
          }}
        >
          {note.text}
        </div>
      )}

      {/* A sentence of grey text was not enough — it read as a caption, and
          people were not sure they had actually signed in. This is an object:
          their initials, their name, their year, and the way out. */}
      {signedIn && (
        <div
          className="ps-panel mb-6"
          style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', flexWrap: 'wrap' }}
        >
          <div
            aria-hidden="true"
            className="ps-head"
            style={{
              width: 44, height: 44, borderRadius: 999, flex: 'none',
              display: 'grid', placeItems: 'center',
              background: 'var(--ps1)', color: 'var(--ps1-on, #fff)',
              fontWeight: 700, fontSize: 16,
            }}
          >
            {me!.firstName.charAt(0)}{me!.lastName.charAt(0)}
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="font-semibold" style={{ color: 'var(--ink)' }}>
              {me!.firstName} {me!.lastName}
            </div>
            <div className="text-sm text-slate-500">
              Signed in &middot; Class of {me!.batchYear}
              {me!.trustedForStudents && <> &middot; cleared to teach a class</>}
            </div>
          </div>
          <button
            type="button"
            className="text-sm underline underline-offset-2 text-slate-500"
            onClick={() => {
              call('POST', '/alumni/me/sign-out', { session }).catch(() => undefined);
              try { window.localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
              setSession(null);
              setTab('batches');
            }}
          >
            Sign out
          </button>
        </div>
      )}

      {/* One object on one track. `aria-pressed` drives the selected style in
          CSS, so the button's state and its appearance cannot drift apart. */}
      <div className="ps-seg mb-8" role="group" aria-label="Alumni sections">
        {TABS.map((t) => {
          const locked = t.needsSession && !signedIn;
          return (
            <button
              key={t.id}
              type="button"
              className="ps-seg-btn"
              disabled={locked}
              aria-pressed={tab === t.id}
              title={locked ? 'Sign in to open this' : undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {!signedIn && <SignInPanel onSignedIn={(sess, name) => {
        try { window.localStorage.setItem(SESSION_KEY, sess); } catch { /* ignore */ }
        setSession(sess);
        setTab('profile');
        setNote({ kind: 'ok', text: `Welcome back, ${name}.` });
      }} />}

      {!signedIn && tab === 'batches' && (
        <p className="text-sm text-slate-500 mb-6 max-w-2xl">
          <strong className="text-slate-700">This page is public on purpose.</strong> Anyone can read it without
          signing in — which is how somebody who left in 1998 finds themselves from a search engine. Nothing on it
          is a contact detail unless its owner published one.
        </p>
      )}

      {tab === 'batches' && <Batches schoolName={schoolName} />}
      {tab === 'directory' && signedIn && <Directory session={session} />}
      {tab === 'give' && signedIn && <Give session={session} onNote={setNote} onGo={setTab} />}
      {tab === 'giving' && signedIn && <Giving session={session} onGo={setTab} />}
      {tab === 'profile' && signedIn && <Profile me={me!} session={session} onNote={setNote} />}
    </section>
  );
}

/* ─── Batches, the public half ───────────────────────────────────────────── */

function Batches({ schoolName }: { schoolName: string }) {
  const [index, setIndex] = useState<BatchIndexRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [page, setPage] = useState<BatchPage | null>(null);

  useEffect(() => {
    call<BatchIndexRow[]>('GET', '/alumni/batches').then(setIndex).catch(() => setIndex([]));
  }, []);
  useEffect(() => {
    if (open === null) { setPage(null); return; }
    call<BatchPage>('GET', `/alumni/batches/${open}`).then(setPage).catch(() => setPage(null));
  }, [open]);

  if (!index) return <p className="text-sm text-slate-500">Loading…</p>;
  if (index.length === 0) {
    return (
      <div className="ps-panel p-12 text-center">
        <svg viewBox="0 0 120 90" className="mx-auto h-24 w-32" fill="none" aria-hidden="true">
          <path d="M20 62V34l40-16 40 16v28" stroke="var(--ps1)" strokeWidth="2.5" opacity=".35" strokeLinejoin="round" />
          <path d="M60 18v44" stroke="var(--ps1)" strokeWidth="2.5" opacity=".2" />
          <circle cx="44" cy="70" r="5" fill="var(--ps2)" opacity=".45" />
          <circle cx="60" cy="70" r="5" fill="var(--ps2)" opacity=".3" />
          <circle cx="76" cy="70" r="5" fill="var(--ps2)" opacity=".18" />
        </svg>
        <h3 className="ps-head font-bold text-lg mt-5">No years recorded yet</h3>
        <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
          As {schoolName} traces its old pupils, every leaving year appears here with the ones found so far.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="ps-seg">
        {index.map((b) => (
          <button
            key={b.batchYear}
            type="button"
            className="ps-seg-btn"
            aria-pressed={open === b.batchYear}
            onClick={() => setOpen(open === b.batchYear ? null : b.batchYear)}
          >
            {b.batchYear}
            <span className="ml-2 opacity-70 tabular-nums">
              {b.found}{b.registerStrength ? `/${b.registerStrength}` : ''}
            </span>
          </button>
        ))}
      </div>

      <ClaimForm defaultYear={open} schoolName={schoolName} />

      {open !== null && (
        <div className="ps-panel p-8 mt-8">
          <h3 className="ps-head font-bold text-2xl">Class of {open}</h3>
          {page && (
            <>
              <p className="text-sm text-slate-500 mt-1">
                {page.coverage === null
                  ? `${page.found} found — the school has not recorded how many were in that year`
                  : `${page.found} of ${page.registerStrength} found — help us find the other ${page.stillMissing}`}
              </p>
              {page.coverage !== null && (
                <div className="ps-bar-track mt-4">
                  <div className="ps-bar-fill" style={{ width: `${page.coverage}%` }} />
                </div>
              )}
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {page.alumni.map((a) => (
                  <div key={a.id} className="ps-card p-4">
                    <div className="font-semibold">{a.name}</div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      {[a.city, a.profession, a.employer].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {a.isMentor && (
                      <span className="ps-chip px-3 py-1 rounded-full mt-3 inline-block text-xs font-semibold border border-black/5" style={{ borderColor: 'var(--ps2)' }}>
                        will mentor
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {page.alumni.length === 0 && (
                <p className="text-sm text-slate-500 mt-6">Nobody from this year has been found yet.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Directory ──────────────────────────────────────────────────────────── */

function Directory({ session }: { session: string | null }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<DirRow[]>([]);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    call<{ rows: DirRow[]; total: number }>('GET', `/alumni/me/directory?${p}`, { session })
      .then((r) => { setRows(r.rows); setTotal(r.total); setFailed(false); })
      // Swallowing this into an empty list said "nobody matches that" when the
      // truth was "the request failed" — the two need different reactions from
      // the person reading the screen.
      .catch(() => { setRows([]); setTotal(0); setFailed(true); });
  }, [q, session]);

  return (
    <div>
      <input
        className="ps-wiz-input w-full max-w-md"
        placeholder="Name, profession or employer…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search the directory"
      />
      <p className="text-sm text-slate-500 mt-3">
        <strong className="text-slate-700">{total}</strong> verified alumni. What you see, each person chose to show —
        contact details stay hidden unless they opened them. Students cannot open this screen at all.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((a) => (
          <div key={a.id} className="ps-card p-4">
            <div className="font-semibold">
              {a.name} <span className="text-slate-500 text-sm tabular-nums">{a.batchYear}</span>
            </div>
            <div className="text-sm text-slate-500 mt-0.5">
              {[a.city, a.profession, a.employer].filter(Boolean).join(' · ') || '—'}
            </div>
            {(a.phone || a.email) && (
              <div className="text-sm mt-1" style={{ color: 'var(--ps1)' }}>
                {[a.phone, a.email].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>
      {rows.length === 0 && (
        <p className="text-sm text-slate-500 mt-6">
          {failed ? 'The directory could not be loaded. Try again in a moment.' : 'Nobody matches that.'}
        </p>
      )}
    </div>
  );
}

/* ─── My giving ──────────────────────────────────────────────────────────── */

interface GivingEvent { status: string; note: string | null; at: string; label: string }
interface GivingAttachment { id: string; kind: 'BILL' | 'CONSIGNMENT' | 'DISTRIBUTION'; url: string; caption: string | null }
interface GivingRow {
  id: string;
  giftItem: { name: string; unit: string } | null;
  customRequest: string | null;
  scopeKind: string;
  quantity: number;
  mode: 'FUND' | 'SUPPLY';
  amountMinor: number | null;
  currency: string;
  status: string;
  statusLabel: string;
  journey: string[];
  journeyIndex: number;
  events: GivingEvent[];
  attachments: GivingAttachment[];
  thankYouNote: string | null;
  courier: string | null;
  trackingRef: string | null;
  declineReason: string | null;
  counterNote: string | null;
  received: number;
  short: number;
  createdAt: string;
}
interface GivingSummary {
  gifts: number; inFlight: number; childrenReached: number; fundedMinor: number; currency: string;
}

const onDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Everything one alumnus has given, and what happened to it.
 *
 * The screen that decides whether somebody gives twice. A donation that
 * disappears into an institution and is never mentioned again reads as having
 * been unwelcome — so this leads with what they achieved, and every row carries
 * the whole journey rather than a status word.
 */
function Giving({ session, onGo }: { session: string | null; onGo: (t: TabId) => void }) {
  const [rows, setRows] = useState<GivingRow[] | null>(null);
  const [sum, setSum] = useState<GivingSummary | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    call<GivingRow[]>('GET', '/alumni/me/pledges', { session }).then(setRows).catch(() => setRows([]));
    call<GivingSummary>('GET', '/alumni/me/giving', { session }).then(setSum).catch(() => undefined);
  }, [session]);

  if (!rows) return <p className="text-sm text-slate-500">Loading&hellip;</p>;

  if (rows.length === 0) {
    return (
      <div className="ps-panel p-7 max-w-xl">
        <h3 className="ps-head font-bold text-lg">Nothing yet</h3>
        <p className="text-sm text-slate-600 mt-2">
          When you give something, this is where you follow it — from the office accepting it, all
          the way to photographs of the children who got it.
        </p>
        <button type="button" className="ps-cta ps-cta-1 mt-5" onClick={() => onGo('give')}>
          Give something
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Children reached, not rupees given: the number that means something to
          a donor is how many people got something — and an in-kind gift has
          deliberately no rupee figure to add up at all. */}
      {sum && sum.childrenReached > 0 && (
        <div className="ps-panel p-7 mb-6">
          <p className="ps-head font-bold" style={{ fontSize: 34, lineHeight: 1.1, color: 'var(--ps1)' }}>
            {sum.childrenReached} {sum.childrenReached === 1 ? 'child' : 'children'}
          </p>
          <p className="text-sm text-slate-600 mt-2">
            {sum.childrenReached === 1 ? 'has' : 'have'} received something because of you, across{' '}
            {sum.gifts} {sum.gifts === 1 ? 'gift' : 'gifts'}.
            {sum.inFlight > 0 && <> {sum.inFlight} still on the way.</>}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((r) => {
          const what = r.giftItem?.name ?? r.customRequest ?? 'A gift';
          const ended = r.journeyIndex < 0;
          const isOpen = open === r.id;
          return (
            <div key={r.id} className="ps-panel p-6">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div className="ps-head font-bold text-lg">
                    {r.quantity} &times; {what.toLowerCase()}
                  </div>
                  <div className="text-sm text-slate-500 mt-0.5">
                    Offered {onDate(r.createdAt)}
                    {r.mode === 'FUND' && r.amountMinor ? ` · ${rupees(r.amountMinor)}` : ' · you sent the goods'}
                  </div>
                </div>
                <span
                  className="ps-chip px-3 py-1.5 rounded-full text-xs font-semibold"
                  style={ended
                    ? { background: '#f2e6e6', color: '#8a2b2b' }
                    : r.journeyIndex >= r.journey.length - 1
                      ? { background: 'var(--ps1)', color: 'var(--ps1-on, #fff)' }
                      : undefined}
                >
                  {r.statusLabel}
                </span>
              </div>

              {/* The journey, as a row of steps rather than a word. Somebody who
                  gave months ago is asking "where has it got to", and a single
                  status word answers that badly. */}
              {!ended && (
                <div className="flex flex-wrap items-center gap-1.5 mt-4">
                  {r.journey.map((step, i) => (
                    <div key={step} className="flex items-center gap-1.5">
                      <span
                        className="text-xs font-semibold"
                        style={{
                          padding: '4px 10px',
                          borderRadius: 999,
                          background: i <= r.journeyIndex ? 'var(--ps1)' : 'color-mix(in srgb, var(--ink) 8%, #fff)',
                          color: i <= r.journeyIndex ? 'var(--ps1-on, #fff)' : 'color-mix(in srgb, var(--ink) 55%, transparent)',
                        }}
                      >
                        {GIFT_STEP_WORDS[step] ?? step}
                      </span>
                      {i < r.journey.length - 1 && (
                        <span aria-hidden="true" style={{ color: 'color-mix(in srgb, var(--ink) 30%, transparent)' }}>&rarr;</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Only once the school is actually holding some of it. Before
                  that, "0 of 38 have arrived" reads as a problem rather than as
                  "it has not been sent yet", which is what it means. */}
              {r.status === 'RECEIVED' && r.short > 0 && (
                <p className="text-sm mt-3" style={{ color: '#8a5a00' }}>
                  {r.received} of {r.quantity} {r.received === 1 ? 'has' : 'have'} arrived. It stays
                  open until every child in the group has one.
                </p>
              )}
              {r.declineReason && (
                <p className="text-sm text-slate-600 mt-3">
                  <strong>The school said:</strong> {r.declineReason}
                </p>
              )}
              {r.counterNote && (
                <p className="text-sm text-slate-600 mt-3">
                  <strong>The school suggested instead:</strong> {r.counterNote}
                </p>
              )}
              {(r.courier || r.trackingRef) && (
                <p className="text-sm text-slate-600 mt-3">
                  <strong>On its way with</strong> {r.courier ?? 'a carrier'}
                  {r.trackingRef && <> &middot; <span className="tabular-nums">{r.trackingRef}</span></>}
                </p>
              )}

              {/* The school's own words. For most donors this is the only thing
                  they ever get back, so it is given real weight rather than
                  being tucked into the timeline. */}
              {r.thankYouNote && (
                <blockquote
                  className="mt-4 text-sm"
                  style={{
                    borderLeft: '3px solid var(--ps1)',
                    padding: '10px 14px',
                    background: 'color-mix(in srgb, var(--ps1) 7%, #fff)',
                    borderRadius: 8,
                  }}
                >
                  {r.thankYouNote}
                </blockquote>
              )}

              {r.attachments.length > 0 && (
                <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                  {r.attachments.map((a) => (
                    <figure key={a.id} style={{ margin: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt={a.caption ?? 'From the school'} loading="lazy"
                        style={{ width: '100%', borderRadius: 10, display: 'block' }} />
                      {a.caption && (
                        <figcaption className="text-xs text-slate-500 mt-1">{a.caption}</figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              )}

              {r.events.length > 0 && (
                <>
                  <button
                    type="button"
                    className="text-sm underline underline-offset-2 text-slate-500 mt-4"
                    onClick={() => setOpen(isOpen ? null : r.id)}
                  >
                    {isOpen ? 'Hide the history' : `Full history (${r.events.length})`}
                  </button>
                  {isOpen && (
                    <ol style={{ listStyle: 'none', margin: '14px 0 0', padding: 0 }}>
                      {r.events.map((e, i) => (
                        <li key={`${e.at}-${i}`} className="text-sm" style={{ display: 'flex', gap: 12, padding: '7px 0' }}>
                          <span className="text-slate-500 tabular-nums" style={{ minWidth: 92 }}>{onDate(e.at)}</span>
                          <span>
                            <strong className="text-slate-700">{e.label}</strong>
                            {e.note && <span className="text-slate-600"> — {e.note}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Give ───────────────────────────────────────────────────────────────── */

function Give({
  session,
  onNote,
  onGo,
}: {
  session: string | null;
  onNote: (n: { kind: 'ok' | 'err'; text: string }) => void;
  /** So the confirmation can hand the donor straight to where they follow it. */
  onGo: (tab: TabId) => void;
}) {
  const [groups, setGroups] = useState<GiftGroups | null>(null);
  const [items, setItems] = useState<GiftItem[]>([]);
  const [group, setGroup] = useState<GiftGroup | null>(null);
  const [itemId, setItemId] = useState('');
  /** Off-catalogue. The school's list is a suggestion, not a menu — plenty of
   *  people want to give the thing they happen to have. */
  const [ownItem, setOwnItem] = useState('');
  /** Rupees per child, as typed. Kept as a string so the field can be empty
   *  rather than showing a 0 nobody entered. */
  const [price, setPrice] = useState('');
  const [mode, setMode] = useState<'SUPPLY' | 'FUND'>('SUPPLY');
  const [ded, setDed] = useState('');
  const [pickup, setPickup] = useState({ address: '', contact: '', phone: '', note: '' });
  const [busy, setBusy] = useState(false);
  /** The pledge that was just made, so the screen can say so properly instead
   *  of flashing a line of text and forgetting. */
  const [done, setDone] = useState<{ what: string; qty: number; group: string } | null>(null);

  useEffect(() => {
    call<GiftGroups>('GET', '/alumni/me/gift-groups', { session }).then(setGroups).catch(() => undefined);
    call<GiftItem[]>('GET', '/alumni/me/gift-items', { session }).then(setItems).catch(() => undefined);
  }, [session]);

  const all = useMemo(
    () => (groups ? [groups.school, ...groups.grades, ...groups.sections] : []),
    [groups],
  );
  const item = items.find((i) => i.id === itemId);
  const qty = group?.headcount ?? 0;
  const custom = itemId === '' && ownItem.trim().length >= 3;
  const whatLabel = item?.name ?? ownItem.trim();
  /** Paise. The donor types rupees; nothing downstream ever sees a float. */
  const unitPaise = Math.round(Number(price || '0') * 100);
  const chosen = !!group && (!!itemId || custom);
  const fundable = mode === 'FUND' ? unitPaise > 0 : true;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="ps-panel p-7">
        <h3 className="ps-head font-bold text-lg">1 · Who is it for</h3>
        <p className="text-sm text-slate-500 mt-1">
          Live from the register. Counts only — never a child&rsquo;s name, photograph or fee status.
        </p>
        {/* A real school has ten grades and twenty sections. Forty chips on one
            track is not a control, so the groups are split by kind and only the
            one being used is expanded. */}
        {([
          ['The whole school', groups ? [groups.school] : []],
          ['By year group', groups?.grades ?? []],
          ['One class', groups?.sections ?? []],
        ] as const).map(([heading, list]) => list.length > 0 && (
          <div key={heading} className="mt-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              {heading}
            </div>
            <div className="ps-choices">
              {list.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  className="ps-choice"
                  aria-pressed={group?.label === g.label}
                  onClick={() => setGroup(group?.label === g.label ? null : g)}
                >
                  <span className="ps-choice-mark" aria-hidden="true" />
                  <span>
                    <span className="ps-choice-name">{g.label}</span>
                    <span className="ps-choice-meta tabular-nums">
                      {g.headcount} {g.headcount === 1 ? 'child' : 'children'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <h3 className="ps-head font-bold text-lg mt-8">2 · What</h3>
        <p className="text-sm text-slate-500 mt-1">
          Written by the school. Anything off this list becomes a proposal the office can redirect.
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 mt-5">The school has not published a wish list yet.</p>
        ) : (
          <div className="ps-choices mt-5">
            {items.map((i) => (
              <button
                key={i.id}
                type="button"
                className="ps-choice"
                aria-pressed={itemId === i.id}
                onClick={() => { setItemId(itemId === i.id ? '' : i.id); if (itemId !== i.id) setOwnItem(''); }}
              >
                <span className="ps-choice-mark" aria-hidden="true" />
                <span>
                  <span className="ps-choice-name">{i.name}</span>
                  <span className="ps-choice-meta">
                    about {rupees(i.indicativeCostMinor)} {i.unit}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* The list is a suggestion, not a menu. Plenty of people want to give
            the thing they happen to have, and a form that only accepts four
            options turns those people away. */}
        <label className="block text-sm mt-4">
          <span className="text-slate-500">
            {items.length === 0 ? 'What would you like to give?' : 'Or something else entirely'}
          </span>
          <input
            className="ps-wiz-input w-full mt-1"
            placeholder="Sports kit for the under-14 team"
            value={ownItem}
            onChange={(e) => { setOwnItem(e.target.value); if (e.target.value.trim()) setItemId(''); }}
          />
        </label>
        {custom && (
          <p className="text-xs text-slate-500 mt-1">
            Off the school&rsquo;s list, so this arrives as a proposal — the office can accept it or
            suggest something they need more.
          </p>
        )}

        <label className="block text-sm mt-5">
          <span className="text-slate-500">What you would like to give per child</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-slate-500 text-base">&#8377;</span>
            <input
              className="ps-wiz-input w-40"
              inputMode="decimal"
              placeholder="0"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
              aria-label="Amount per child in rupees"
            />
            {item && (
              <button
                type="button"
                className="text-xs underline underline-offset-2 text-slate-500"
                onClick={() => setPrice(String(item.indicativeCostMinor / 100))}
              >
                use the school&rsquo;s estimate ({rupees(item.indicativeCostMinor)})
              </button>
            )}
          </div>
        </label>
        <p className="text-xs text-slate-500 mt-1">
          Leave it at <strong className="text-slate-700">0</strong> if you are sending the goods
          yourself — we will arrange collection from your address and get them to the school.
        </p>

        <h3 className="ps-head font-bold text-lg mt-8">3 · How it arrives</h3>
        <div className="ps-seg mt-4">
          {(['SUPPLY', 'FUND'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="ps-seg-btn"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === 'SUPPLY' ? 'I will send the goods' : 'I will pay, school buys'}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-500 mt-4">
          {mode === 'SUPPLY'
            ? 'No money changes hands here. You commit to a quantity; the office records what actually arrives, and you can follow it the whole way. Note: gifts in kind are generally not eligible for 80G relief — if you need a certificate, choose “I will pay”.'
            : 'On the school’s own payment rail. The school is the merchant, never us, and the receipt comes from them.'}
        </p>

        {/* Only asked when there is something to collect. A donor in Toronto
            funding a purchase is never asked where to send a courier. */}
        {mode === 'SUPPLY' && (
          <>
            <h3 className="ps-head font-bold text-lg mt-8">4 · Where to collect it</h3>
            <p className="text-sm text-slate-500 mt-1">
              Optional — you can settle this with the office later. Filling it in now just means
              nobody has to ring you.
            </p>
            <label className="block text-sm mt-4">
              <span className="text-slate-500">Pickup address</span>
              <input className="ps-wiz-input w-full mt-1" placeholder="14 Residency Road, Pune 411001"
                value={pickup.address}
                onChange={(e) => setPickup((v) => ({ ...v, address: e.target.value }))} />
            </label>
            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <label className="block text-sm">
                <span className="text-slate-500">Who will hand it over</span>
                <input className="ps-wiz-input w-full mt-1" placeholder="My mother, or the watchman"
                  value={pickup.contact}
                  onChange={(e) => setPickup((v) => ({ ...v, contact: e.target.value }))} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-500">Phone for the pickup</span>
                <input className="ps-wiz-input w-full mt-1" placeholder="+91 98123 45678"
                  value={pickup.phone}
                  onChange={(e) => setPickup((v) => ({ ...v, phone: e.target.value }))} />
              </label>
            </div>
            <label className="block text-sm mt-4">
              <span className="text-slate-500">Anything the driver should know</span>
              <input className="ps-wiz-input w-full mt-1" placeholder="Six cartons, second floor, no lift"
                value={pickup.note}
                onChange={(e) => setPickup((v) => ({ ...v, note: e.target.value }))} />
            </label>
          </>
        )}
        <label className="block text-sm mt-5">
          <span className="text-slate-500">Dedication — optional</span>
          <input
            className="ps-wiz-input w-full mt-1"
            placeholder="In memory of Shri R. K. Meena, my father"
            value={ded}
            onChange={(e) => setDed(e.target.value)}
          />
        </label>
      </div>

      <div className="ps-panel p-7 self-start">
        {done ? (
          /* A pledge that vanishes the instant it is made reads as having gone
             nowhere. This stays until the donor dismisses it, says exactly what
             was promised, and points them at where to follow it. */
          <>
            <div style={{ fontSize: 30, lineHeight: 1 }} aria-hidden="true">&#10003;</div>
            <h3 className="ps-head font-bold text-lg mt-3">That is with the office</h3>
            <p className="ps-head font-bold text-2xl mt-3" style={{ color: 'var(--ps1)' }}>
              {done.qty} &times; {done.what.toLowerCase()}
            </p>
            <p className="text-sm text-slate-600 mt-2">
              for <strong>{done.group}</strong>. Nothing is charged or collected until the school
              accepts it — you will see that happen, and every step afterwards, under{' '}
              <strong>My giving</strong>.
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <button type="button" className="ps-cta ps-cta-ink" onClick={() => onGo('giving')}>
                Follow it
              </button>
              <button
                type="button"
                className="text-sm underline underline-offset-2 text-slate-500"
                onClick={() => { setDone(null); setItemId(''); setOwnItem(''); setPrice(''); setDed(''); }}
              >
                Give something else
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="ps-head font-bold text-lg">Your pledge</h3>
            {!chosen ? (
              <p className="text-sm text-slate-500 mt-2">
                Pick a group, then choose something from the list or type your own.
              </p>
            ) : (
              <>
                <p className="ps-head font-bold text-3xl mt-3" style={{ color: 'var(--ps1)' }}>
                  {qty} &times; {whatLabel.toLowerCase()}
                </p>
                <p className="text-sm text-slate-500 mt-2">
                  for <strong className="text-slate-700">{group!.label}</strong> — {qty} children. The
                  quantity <strong className="text-slate-700">is</strong> the headcount and is not
                  something you can edit: a class of {qty} with fewer than {qty} is a worse place than
                  one with none.
                </p>

                {mode === 'FUND' ? (
                  unitPaise > 0 ? (
                    <p className="text-sm text-slate-500 mt-3 tabular-nums">
                      {qty} &times; {rupees(unitPaise)} ={' '}
                      <strong className="text-slate-700">{rupees(unitPaise * qty)}</strong>
                    </p>
                  ) : (
                    <p className="text-sm mt-3" style={{ color: '#b3261e' }}>
                      Enter what you would like to give per child, or switch to{' '}
                      <em>I will send the goods</em>.
                    </p>
                  )
                ) : (
                  <p className="text-sm text-slate-500 mt-3">
                    You are sending the goods, so no amount is recorded against this — an in-kind
                    gift is counted in things, never in rupees.
                  </p>
                )}

                <button
                  type="button"
                  className="ps-cta ps-cta-1 mt-6"
                  disabled={busy || !fundable}
                  onClick={() => {
                    setBusy(true);
                    call('POST', '/alumni/me/pledges', {
                      session,
                      body: {
                        scopeKind: group!.scopeKind,
                        gradeId: group!.gradeId,
                        classSectionId: group!.classSectionId,
                        giftItemId: itemId || undefined,
                        customRequest: custom ? ownItem.trim() : undefined,
                        mode,
                        unitPriceMinor: mode === 'FUND' ? unitPaise : undefined,
                        pickupAddress: mode === 'SUPPLY' && pickup.address.trim() ? pickup.address.trim() : undefined,
                        pickupContact: mode === 'SUPPLY' && pickup.contact.trim() ? pickup.contact.trim() : undefined,
                        pickupPhone: mode === 'SUPPLY' && pickup.phone.trim() ? pickup.phone.trim() : undefined,
                        pickupNote: mode === 'SUPPLY' && pickup.note.trim() ? pickup.note.trim() : undefined,
                        dedicationKind: ded.trim() ? 'IN_MEMORY_OF' : 'NONE',
                        dedicationText: ded.trim() || undefined,
                      },
                    })
                      .then(() => setDone({ what: whatLabel, qty, group: group!.label }))
                      .catch((e: Error) => onNote({ kind: 'err', text: e.message }))
                      .finally(() => setBusy(false));
                  }}
                >
                  {busy ? 'Sending…' : mode === 'FUND' ? 'Pledge this' : 'Offer to send this'}
                </button>
                <p className="text-xs text-slate-500 mt-3">
                  Nothing is charged or collected until the school accepts.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Profile ────────────────────────────────────────────────────────────── */

function Profile({
  me,
  session,
  onNote,
}: { me: Me; session: string | null; onNote: (n: { kind: 'ok' | 'err'; text: string }) => void }) {
  const [draft, setDraft] = useState({
    phone: me.phone ?? '', city: me.city ?? '', profession: me.profession ?? '',
    employer: me.employer ?? '', collegeName: me.collegeName ?? '', isMentor: me.isMentor,
  });
  const [privacy, setPrivacy] = useState<Record<string, string>>(me.privacy ?? {});
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="ps-panel p-7">
        <h3 className="ps-head font-bold text-lg">Where you got to</h3>
        <p className="text-sm text-slate-500 mt-1">
          Only you can change this, and only you decide who sees each line.
        </p>
        <div className="mt-5 space-y-4">
          {([['city', 'City'], ['profession', 'Profession'], ['employer', 'Employer'],
             ['collegeName', 'College'], ['phone', 'Phone']] as const).map(([k, label]) => (
            <label key={k} className="block text-sm">
              <span className="text-slate-500">{label}</span>
              <input
                className="ps-wiz-input w-full mt-1"
                value={draft[k]}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.isMentor}
              onChange={(e) => setDraft((d) => ({ ...d, isMentor: e.target.checked }))}
            />
            I am willing to mentor
          </label>
        </div>
      </div>

      <div className="ps-panel p-7">
        <h3 className="ps-head font-bold text-lg">Who can see what</h3>
        <p className="text-sm text-slate-500 mt-1">
          Every field starts closed. You open each one deliberately, and can shut it again.
        </p>
        <div className="mt-5 space-y-4">
          {PRIVACY_FIELDS.map((f) => (
            <div key={f.key}>
              <div className="text-sm font-medium">{f.label}</div>
              <div className="ps-seg mt-1.5">
                {PRIVACY_LEVELS.map((lv) => {
                  const on = (privacy[f.key] ?? 'HIDDEN') === lv;
                  return (
                    <button
                      key={lv}
                      type="button"
                      className="ps-seg-btn ps-seg-sm"
                      aria-pressed={on}
                      onClick={() => setPrivacy((p) => ({ ...p, [f.key]: lv }))}
                    >
                      {lv === 'ALUMNI' ? 'Alumni' : lv === 'BATCH' ? 'My batch' : lv === 'PUBLIC' ? 'Public' : 'Hidden'}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="ps-cta ps-cta-1 mt-7"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            call('PUT', '/alumni/me', { session, body: { ...draft, privacy } })
              .then(() => onNote({ kind: 'ok', text: 'Saved.' }))
              .catch((e: Error) => onNote({ kind: 'err', text: e.message }))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ─── "I was a student here" ─────────────────────────────────────────────── */

/**
 * The public front door to the school's verification queue.
 *
 * Five fields, because every one of them is something a person genuinely
 * remembers about a school they left twenty years ago, and anything more is a
 * form they abandon. The batch year pre-fills from whichever year they were
 * looking at, which is the whole reason this sits under the year list rather
 * than on a page of its own.
 *
 * It promises nothing it cannot keep: there is no status page and no automatic
 * email, so the closing line says a person will be in touch, not "check back".
 */
function ClaimForm({ defaultYear, schoolName }: { defaultYear: number | null; schoolName: string }) {
  const [openForm, setOpenForm] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    firstName: '', lastName: '', batchYear: '', dob: '', claimedClass: '',
    email: '', phone: '', proof: '',
  });

  // Follows the year they opened, until they type their own.
  const [touchedYear, setTouchedYear] = useState(false);
  useEffect(() => {
    if (!touchedYear && defaultYear !== null) setF((x) => ({ ...x, batchYear: String(defaultYear) }));
  }, [defaultYear, touchedYear]);

  if (sent) {
    return (
      <div className="ps-panel p-8 mt-8" role="status">
        <h3 className="ps-head font-bold text-lg">Thank you — that is with the office.</h3>
        <p className="text-sm text-slate-500 mt-2 max-w-xl">
          Somebody at {schoolName} will check the register and get in touch on the email or number
          you left. Nobody else can see what you sent, and you do not appear anywhere on this site
          until a person has matched you to the roll.
        </p>
      </div>
    );
  }

  if (!openForm) {
    return (
      <div className="mt-8">
        <button type="button" className="ps-cta ps-cta-1" onClick={() => setOpenForm(true)}>
          Tell us you were here →
        </button>
      </div>
    );
  }

  const ready = f.firstName.trim() && f.lastName.trim() && f.batchYear && f.proof.trim().length >= 3
    && (f.email.trim() || f.phone.trim());

  return (
    <form
      className="ps-panel p-8 mt-8 max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        call('POST', '/alumni/claims', {
          body: {
            firstName: f.firstName.trim(),
            lastName: f.lastName.trim(),
            batchYear: Number(f.batchYear),
            dob: f.dob || undefined,
            claimedClass: f.claimedClass.trim() || undefined,
            email: f.email.trim() || undefined,
            phone: f.phone.trim() || undefined,
            proof: f.proof.trim(),
          },
        })
          .then(() => setSent(true))
          .catch((e2: Error) => setErr(e2.message))
          .finally(() => setBusy(false));
      }}
    >
      <h3 className="ps-head font-bold text-lg">Were you a student here?</h3>
      <p className="text-sm text-slate-500 mt-1">
        Five things, and the office checks them against the register by hand. Nothing you send
        appears on this site until a person has matched you to the roll.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 mt-6">
        <label className="block text-sm">
          <span className="text-slate-500">First name</span>
          <input className="ps-wiz-input w-full mt-1" required value={f.firstName}
            onChange={(e) => setF({ ...f, firstName: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-500">Last name</span>
          <input className="ps-wiz-input w-full mt-1" required value={f.lastName}
            onChange={(e) => setF({ ...f, lastName: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-500">The year you left</span>
          <input className="ps-wiz-input w-full mt-1" type="number" required
            min={1900} max={2100} placeholder="1998" value={f.batchYear}
            onChange={(e) => { setTouchedYear(true); setF({ ...f, batchYear: e.target.value }); }} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-500">Your date of birth</span>
          <input className="ps-wiz-input w-full mt-1" type="date" value={f.dob}
            onChange={(e) => setF({ ...f, dob: e.target.value })} />
          <span className="text-xs text-slate-500 mt-1 block">
            The school can check this against its own records — it is the quickest way to find you.
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-slate-500">Your class, if you remember it</span>
          <input className="ps-wiz-input w-full mt-1" placeholder="10 – B, or leave blank"
            value={f.claimedClass} onChange={(e) => setF({ ...f, claimedClass: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-500">Email or phone — either is enough</span>
          <input className="ps-wiz-input w-full mt-1" placeholder="you@example.com" value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input className="ps-wiz-input w-full mt-2" placeholder="Phone" value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </label>
      </div>

      <label className="block text-sm mt-4">
        <span className="text-slate-500">Anything else the school can check</span>
        <textarea className="ps-wiz-input w-full mt-1" rows={3} required
          placeholder="Your father's or mother's name, your admission number, a class teacher, or two classmates — anything the office can look up."
          value={f.proof} onChange={(e) => setF({ ...f, proof: e.target.value })} />
      </label>

      {err && <p className="text-sm mt-4" style={{ color: '#b3261e' }}>{err}</p>}

      <div className="flex flex-wrap gap-3 mt-6">
        <button type="submit" className="ps-cta ps-cta-1" disabled={!ready || busy}
          style={!ready || busy ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
          {busy ? 'Sending…' : 'Send this to the office'}
        </button>
        <button type="button" className="ps-btn" onClick={() => setOpenForm(false)}>Cancel</button>
      </div>
    </form>
  );
}

/* ─── The door ───────────────────────────────────────────────────────────── */

/**
 * One control, three ways in, and they are three because an alumnus arrives in
 * one of exactly three states:
 *
 *   1. HAS AN ACCOUNT     — email and password. The ordinary login, for people
 *                           who asked the school for one and for the batch
 *                           captain who opens this weekly.
 *   2. HAD A LINK, LOST IT— "send me my link". Goes to the office queue rather
 *                           than an inbox, because email does not work yet;
 *                           the office pastes a fresh link into WhatsApp.
 *   3. NOT REGISTERED     — the claim form, which is a request for an account
 *                           that a human approves against the register.
 *
 * A fourth state — HAS a link, in their hand — needs no door at all: opening it
 * signs them in.
 */
function SignInPanel({ onSignedIn }: { onSignedIn: (session: string, firstName: string) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  if (!open) {
    return (
      <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* Same weight as the site's "Enquire now", in the CONTRAST fill: the
            primary colour is already spoken for by the selected tab a few
            pixels above, and two indigo objects that close together read as
            one smear rather than two choices. */}
        <button type="button" className="ps-cta ps-cta-ink" onClick={() => setOpen(true)}>
          Sign in
          <span aria-hidden="true">&rarr;</span>
        </button>
        <span className="text-sm text-slate-600">
          Already registered? Sign in, or ask the school for your link.
        </span>
      </div>
    );
  }

  return (
    <div className="ps-panel p-7 mb-8 max-w-xl">
      <div className="ps-seg">
        {([['password', 'I have a password'], ['link', 'Send me my link']] as const).map(([m, label]) => (
          <button key={m} type="button"
            className="ps-seg-btn"
            aria-pressed={mode === m}
            onClick={() => { setMode(m); setMsg(null); }}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'password' ? (
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true); setMsg(null);
            call<{ session: string; alumni: { firstName: string } }>('POST', '/alumni/login', {
              body: { email: email.trim(), password },
            })
              .then((r) => onSignedIn(r.session, r.alumni.firstName))
              .catch((e2: Error) => setMsg({ kind: 'err', text: e2.message }))
              .finally(() => setBusy(false));
          }}
        >
          <label className="block text-sm">
            <span className="text-slate-500">Email</span>
            <input className="ps-wiz-input w-full mt-1" type="email" required autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block text-sm mt-3">
            <span className="text-slate-500">Password</span>
            <input className="ps-wiz-input w-full mt-1" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <p className="text-xs text-slate-500 mt-2">
            The school gives you this when it approves you. Not got one? Use <em>Send me my link</em>.
          </p>
          <button type="submit" className="ps-cta ps-cta-1 mt-4" disabled={busy}
            style={busy ? { opacity: 0.5 } : undefined}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true); setMsg(null);
            call('POST', '/alumni/link-request', { body: { contact: contact.trim() } })
              .then(() => setMsg({
                kind: 'ok',
                text: 'If that reaches somebody on our roll, the school will send a fresh link to it.',
              }))
              .catch((e2: Error) => setMsg({ kind: 'err', text: e2.message }))
              .finally(() => setBusy(false));
          }}
        >
          <label className="block text-sm">
            <span className="text-slate-500">The email or phone the school has for you</span>
            <input className="ps-wiz-input w-full mt-1" required value={contact}
              onChange={(e) => setContact(e.target.value)} />
          </label>
          <p className="text-xs text-slate-500 mt-2">
            No password needed. The office sends you a link that signs you in for ninety days.
          </p>
          <button type="submit" className="ps-cta ps-cta-1 mt-4" disabled={busy}
            style={busy ? { opacity: 0.5 } : undefined}>
            {busy ? 'Sending…' : 'Ask for my link'}
          </button>
        </form>
      )}

      {msg && (
        <p className="text-sm mt-4" style={{ color: msg.kind === 'ok' ? 'var(--ps1)' : '#b3261e' }}>
          {msg.text}
        </p>
      )}
      <button type="button" className="text-sm text-slate-500 underline underline-offset-2 mt-4"
        onClick={() => setOpen(false)}>
        Close
      </button>
    </div>
  );
}
