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
interface GiftItem { id: string; name: string; indicativeCostMinor: number; currency: string }

type Tab = 'batches' | 'directory' | 'give' | 'profile';

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

      {signedIn && (
        <p className="text-sm text-slate-500 mb-5">
          Signed in as <strong className="text-slate-700">{me!.firstName} {me!.lastName}</strong>,
          Class of {me!.batchYear}. No password — this device stays known for ninety days.{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => {
              call('POST', '/alumni/me/sign-out', { session }).catch(() => undefined);
              try { window.localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
              setSession(null);
              setTab('batches');
            }}
          >
            Sign out
          </button>
        </p>
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
      {tab === 'give' && signedIn && <Give session={session} onNote={setNote} />}
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
      <div className="ps-seg ps-seg-wrap flex-wrap">
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

/* ─── Give ───────────────────────────────────────────────────────────────── */

function Give({
  session,
  onNote,
}: { session: string | null; onNote: (n: { kind: 'ok' | 'err'; text: string }) => void }) {
  const [groups, setGroups] = useState<GiftGroups | null>(null);
  const [items, setItems] = useState<GiftItem[]>([]);
  const [group, setGroup] = useState<GiftGroup | null>(null);
  const [itemId, setItemId] = useState('');
  const [mode, setMode] = useState<'SUPPLY' | 'FUND'>('SUPPLY');
  const [ded, setDed] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="ps-panel p-7">
        <h3 className="ps-head font-bold text-lg">1 · Who is it for</h3>
        <p className="text-sm text-slate-500 mt-1">
          Live from the register. Counts only — never a child&rsquo;s name, photograph or fee status.
        </p>
        <div className="ps-seg ps-seg-wrap flex-wrap mt-5">
          {all.map((g) => (
            <button
              key={g.label}
              type="button"
              className="ps-seg-btn"
              aria-pressed={group?.label === g.label}
              onClick={() => setGroup(group?.label === g.label ? null : g)}
            >
              {g.label}<span className="ml-2 opacity-70 tabular-nums">{g.headcount}</span>
            </button>
          ))}
        </div>

        <h3 className="ps-head font-bold text-lg mt-8">2 · What</h3>
        <p className="text-sm text-slate-500 mt-1">
          Written by the school. Anything off this list becomes a proposal the office can redirect.
        </p>
        <div className="ps-seg ps-seg-wrap flex-wrap mt-5">
          {items.map((i) => (
            <button
              key={i.id}
              type="button"
              className="ps-seg-btn"
              aria-pressed={itemId === i.id}
              onClick={() => setItemId(itemId === i.id ? '' : i.id)}
            >
              {i.name}<span className="ml-2 opacity-70">{rupees(i.indicativeCostMinor)}</span>
            </button>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-slate-500">The school has not published a wish list yet.</p>
          )}
        </div>

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
            ? 'No money changes hands here. You commit to a quantity and a date; the office records what actually arrives. Note: gifts in kind are generally not eligible for 80G relief — if you need a certificate, choose “I will pay”.'
            : 'On the school’s own payment rail. The school is the merchant, never us, and the receipt comes from them.'}
        </p>
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
        <h3 className="ps-head font-bold text-lg">Your pledge</h3>
        {!group || !itemId ? (
          <p className="text-sm text-slate-500 mt-2">Pick a group and something from the list.</p>
        ) : (
          <>
            <p className="ps-head font-bold text-3xl mt-3" style={{ color: 'var(--ps1)' }}>
              {qty} × {item?.name.toLowerCase()}
            </p>
            <p className="text-sm text-slate-500 mt-2">
              for <strong className="text-slate-700">{group.label}</strong> — {qty} children. The quantity{' '}
              <strong className="text-slate-700">is</strong> the headcount and is not something you can edit: a class
              of {qty} with fewer than {qty} is a worse place than one with none.
            </p>
            {mode === 'FUND' && item && (
              <p className="text-sm text-slate-500 mt-2 tabular-nums">
                {qty} × {rupees(item.indicativeCostMinor)} = <strong className="text-slate-700">{rupees(item.indicativeCostMinor * qty)}</strong>
              </p>
            )}
            <button
              type="button"
              className="ps-cta ps-cta-1 mt-6"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                call('POST', '/alumni/me/pledges', {
                  session,
                  body: {
                    scopeKind: group.scopeKind,
                    gradeId: group.gradeId,
                    classSectionId: group.classSectionId,
                    giftItemId: itemId,
                    mode,
                    dedicationKind: ded.trim() ? 'IN_MEMORY_OF' : 'NONE',
                    dedicationText: ded.trim() || undefined,
                  },
                })
                  .then(() => onNote({ kind: 'ok', text: 'Sent to the office. Nothing is charged or shipped until they accept.' }))
                  .catch((e: Error) => onNote({ kind: 'err', text: e.message }))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Sending…' : `Pledge ${qty} ${item?.name.toLowerCase()}`}
            </button>
            <p className="text-xs text-slate-500 mt-3">
              The office decides next. Nothing is charged or shipped until they accept.
            </p>
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
              <div className="ps-seg ps-seg-wrap flex-wrap mt-1.5">
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
      <div className="ps-seg ps-seg-wrap flex-wrap">
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
