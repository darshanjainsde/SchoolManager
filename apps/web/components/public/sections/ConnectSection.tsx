'use client';

import { useEffect, useState } from 'react';
import type { PublicSiteData } from '@/lib/public-api';
import { eventDateParts, safeHttpUrl } from '../site-utils';
import { probeSignedIn, submitRegistration, submitRegistrationAsStudent, type SessionProbe } from '../registration-client';

type Ev = PublicSiteData['events'][number];

/** What this browser has already registered for, so it is not asked twice. */
const GOING_KEY = 'sk-going';
type GoingMap = Record<string, 'CONFIRMED' | 'WAITLISTED' | 'HELD'>;

function readGoing(): GoingMap {
  try {
    const raw = window.localStorage.getItem(GOING_KEY);
    return raw ? (JSON.parse(raw) as GoingMap) : {};
  } catch {
    return {};
  }
}

const SYMBOLS: Record<string, string> = { INR: '₹', USD: '$', GBP: '£', EUR: '€', AED: 'AED ' };
/** Minor units → a price a parent reads, with no trailing .00 on round money. */
export function formatPrice(minor: number, currency: string): string {
  const major = minor / 100;
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${Number.isInteger(major) ? major : major.toFixed(2)}`;
}

/** A drawn empty state. A 48px emoji is a shrug; this says what would fill it. */
function NothingOn({ schoolName }: { schoolName: string }) {
  return (
    <div className="reveal mt-10 ps-panel p-12 text-center">
      <svg viewBox="0 0 120 90" className="mx-auto h-24 w-32" fill="none" aria-hidden="true">
        <rect x="12" y="18" width="96" height="62" rx="10" stroke="var(--ps1)" strokeWidth="2.5" opacity=".35" />
        <path d="M12 34h96" stroke="var(--ps1)" strokeWidth="2.5" opacity=".35" />
        <path d="M34 10v14M86 10v14" stroke="var(--ps1)" strokeWidth="2.5" strokeLinecap="round" opacity=".55" />
        <circle cx="42" cy="52" r="4" fill="var(--ps2)" opacity=".5" />
        <circle cx="60" cy="52" r="4" fill="var(--ps2)" opacity=".35" />
        <circle cx="78" cy="52" r="4" fill="var(--ps2)" opacity=".2" />
        <path d="M40 66h40" stroke="var(--ps1)" strokeWidth="2.5" strokeLinecap="round" opacity=".2" />
      </svg>
      <h3 className="ps-head font-bold text-lg mt-5">Nothing on the calendar just yet</h3>
      <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
        Open days, concerts and inter-school fixtures appear here as {schoolName} announces them — and anything the
        wider network is running shows up alongside.
      </p>
    </div>
  );
}

function EventCard({
  event,
  timezone,
  going,
  onJoin,
}: {
  event: Ev;
  timezone: string;
  going: GoingMap[string] | undefined;
  onJoin: (e: Ev) => void;
}) {
  const when = eventDateParts(event.startAt, timezone);
  const cover = safeHttpUrl(event.coverUrl);
  const seatsLeft = event.seatsLeft ?? null;
  const full = seatsLeft === 0;
  // Undefined (an older api that has never heard of registrations) is a closed
  // door, not an open one — the page must not offer a button that 404s.
  const canJoin = event.registrationOpen === true && !going;

  return (
    <div
      data-testid={`event-card-${event.id}`}
      className="reveal ps-lift ps-panel overflow-hidden flex flex-col"
    >
      {cover && <div className="h-36 bg-cover bg-center" style={{ backgroundImage: `url('${cover}')` }} />}
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-start gap-4">
          {/* The date is an object, not a substring of a grey sentence: WHEN is
              the one fact a parent scans a listing for. */}
          <div className="flex-none w-14 ps-panel-sm border border-black/5 text-center py-2 ps-chip">
            <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{when.month}</div>
            <div className="ps-head text-2xl font-bold leading-none mt-0.5">{when.day}</div>
            <div className="text-[10px] opacity-60 mt-1">{when.weekday}</div>
          </div>
          <div className="min-w-0">
            <h3 className="ps-head font-bold text-lg leading-snug">{event.title}</h3>
            <div className="text-sm text-slate-500 mt-1">
              {when.time}
              {event.venue ? ` · ${event.venue}` : ''}
            </div>
            {!event.isHost && event.originSchoolName && (
              <div className="text-[13px] mt-1.5 font-semibold" style={{ color: 'var(--ps1)' }}>
                Hosted by {event.originSchoolName}
              </div>
            )}
          </div>
        </div>

        {event.description && <p className="text-sm text-slate-600 mt-3 line-clamp-3">{event.description}</p>}

        <div className="mt-4 pt-4 border-t border-black/5 flex items-center gap-3 flex-wrap">
          {going ? (
            <span className="text-sm font-semibold" style={{ color: 'var(--ps1)' }}>
              {going === 'WAITLISTED' ? 'You’re on the waitlist' : 'You’re going'}
            </span>
          ) : canJoin ? (
            <>
              <button
                type="button"
                onClick={() => onJoin(event)}
                className="btn-glow ps-accentbg ps-btn text-sm font-semibold px-4 py-2 hover:scale-[1.03] transition"
                style={{ color: 'var(--ink)' }}
              >
                {full ? 'Join the waitlist' : 'Join'}
              </button>
              {/* Beside the button, never buried in the blurb — a Join that
                  cannot say whether anywhere is left sends people to a hall
                  that filled up on Tuesday. */}
              {seatsLeft != null && seatsLeft > 0 && (
                <span className="text-sm text-slate-500">{seatsLeft} seats left</span>
              )}
              {full && <span className="text-sm text-slate-500">Fully booked</span>}
            </>
          ) : (
            !event.isHost && <span className="text-sm text-slate-500">Registration is with the host school</span>
          )}
          {(event.priceMinor ?? 0) > 0 && (
            <span className="text-sm font-semibold ml-auto">
              {formatPrice(event.priceMinor ?? 0, event.currency ?? 'INR')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({
  title,
  blurb,
  events,
  timezone,
  going,
  onJoin,
}: {
  title: string;
  blurb: string;
  events: Ev[];
  timezone: string;
  going: GoingMap;
  onJoin: (e: Ev) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className="mt-12 first:mt-0">
      <h2 className="ps-head text-2xl font-bold"><span className="ps-accent-mark">{title}</span></h2>
      <p className="text-sm text-slate-500 mt-1">{blurb}</p>
      <div className="mt-6 grid md:grid-cols-3 gap-5">
        {events.map((e) => (
          <EventCard key={e.id} event={e} timezone={timezone} going={going[e.id]} onJoin={onJoin} />
        ))}
      </div>
    </div>
  );
}

export default function ConnectSection({
  events,
  timezone,
  schoolName,
}: {
  events: Ev[];
  timezone: string;
  schoolName: string;
}) {
  const [going, setGoing] = useState<GoingMap>({});
  const [joining, setJoining] = useState<Ev | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resolved once, the first time somebody opens the sheet — an anonymous
  // visitor who never registers never pays for the request.
  const [session, setSession] = useState<SessionProbe | 'checking' | null>(null);
  const [justJoined, setJustJoined] = useState<{
    status: string;
    waitlistPos: number | null;
    email: string;
    quantity: number;
  } | null>(null);

  // localStorage is read AFTER mount, never during render: the server cannot
  // reproduce it, and React 19 discards a mismatched subtree silently.
  useEffect(() => setGoing(readGoing()), []);

  const ours = events.filter((e) => e.isHost);
  const network = events.filter((e) => !e.isHost);

  function openSheet(e: Ev) {
    setJoining(e);
    setError(null);
    setJustJoined(null);
    setQuantity(1);
    if (session !== null) return;
    setSession('checking');
    void probeSignedIn()
      .then((r) => setSession(r))
      // A session check that cannot answer must never cost the family the
      // ability to register: fall through to the guest form.
      .catch(() => setSession({ signedIn: false }));
  }

  const signedIn = session !== null && session !== 'checking' && session.signedIn ? session : null;

  async function confirm() {
    if (!joining) return;
    setBusy(true);
    setError(null);
    // Signed in: the place is filed against the pupil, and the family is never
    // asked to retype what the school already knows.
    const result = signedIn
      ? await submitRegistrationAsStudent(joining.id, quantity, signedIn.token)
      : await submitRegistration(joining.id, {
          guestName: name.trim(),
          guestEmail: email.trim(),
          guestPhone: phone.trim(),
          quantity,
        });
    setBusy(false);
    if (!result.ok) {
      setError(
        result.reason === 'rate'
          ? 'Too many attempts just now — please try again in a minute.'
          : result.reason === 'closed'
            ? 'Registration for this event has closed.'
            : 'That could not be saved. Please try again.',
      );
      return;
    }
    const next: GoingMap = { ...going, [joining.id]: result.status };
    setGoing(next);
    try {
      window.localStorage.setItem(GOING_KEY, JSON.stringify(next));
    } catch {
      // A browser refusing storage still gets the confirmation on screen; it
      // only loses the memory of it after a reload.
    }
    setJustJoined({
      status: result.status,
      waitlistPos: result.waitlistPos,
      email: signedIn ? signedIn.name : email.trim(),
      quantity,
    });
    setJoining(null);
  }

  return (
    <section id="events" className="relative overflow-hidden">
      {/* Ambient layer: two blurred brand-coloured drifts, header only. No
          canvas and no library — it is two divs and a keyframe, and it stops
          entirely under the school's own NONE motion level or the visitor's
          prefers-reduced-motion. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 -z-10" aria-hidden="true">
        <div className="ps-amb ps-amb-1" />
        <div className="ps-amb ps-amb-2" />
      </div>

      <div className="max-w-6xl mx-auto px-6 py-14">
        {justJoined && (
          <div
            role="status"
            className="mb-8 ps-panel px-5 py-4 text-sm font-semibold"
            style={{ color: 'var(--ps1)' }}
          >
            {/* The CARD already says "you’re going" — this banner adds what the
                card cannot, and PROMISES NOTHING THE SYSTEM DOES NOT DO. There
                is no confirmation email on this path: the row goes to the
                school's desk and the school works it. */}
            {justJoined.status === 'WAITLISTED'
              ? `Kept your place in the queue — you’re number ${justJoined.waitlistPos ?? '—'}. The school will be in touch if a seat frees up.`
              : `Confirmed — ${justJoined.quantity === 1 ? 'your place is' : `all ${justJoined.quantity} places are`} on the school’s list under ${justJoined.email}.`}
          </div>
        )}

        {events.length === 0 ? (
          <NothingOn schoolName={schoolName} />
        ) : (
          <>
            <Group
              title="At our school"
              blurb={`Everything ${schoolName} is running — you can take a place here.`}
              events={ours}
              timezone={timezone}
              going={going}
              onJoin={openSheet}
            />
            <Group
              title="Across the network"
              blurb="Open to our families too — each one is registered for on the school that runs it."
              events={network}
              timezone={timezone}
              going={going}
              onJoin={openSheet}
            />
          </>
        )}
      </div>

      {joining && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setJoining(null)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Join ${joining.title}`}
            className="relative w-full sm:max-w-md ps-panel p-6"
          >
            <h3 className="ps-head font-bold text-xl">{joining.title}</h3>
            <p className="text-sm text-slate-500 mt-1">
              {(joining.seatsLeft ?? null) === 0
                ? 'This one is full — we’ll keep your place in the queue.'
                : signedIn
                  ? 'One tap and you’re in.'
                  : 'Three things and you’re in.'}
            </p>

            {session === 'checking' && <p className="mt-5 text-sm text-slate-400">Just a moment…</p>}

            {signedIn && (
              /* Whose place this is, stated plainly. A one-tap join that does
                 not say who it books is how the wrong child gets registered on
                 a shared family phone. */
              <div className="mt-5 ps-panel-sm border border-black/5 ps-chip px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Booking for</div>
                <div className="ps-head font-bold text-lg mt-0.5">{signedIn.name}</div>
              </div>
            )}

            {session !== 'checking' && !signedIn && (
              <>
                <label className="block mt-5 text-sm font-semibold">
                  Your name
                  <input
                    value={name}
                    onChange={(ev) => setName(ev.target.value)}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 font-normal text-slate-800"
                    autoComplete="name"
                  />
                </label>
                <label className="block mt-3 text-sm font-semibold">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 font-normal text-slate-800"
                    autoComplete="email"
                  />
                </label>
                <label className="block mt-3 text-sm font-semibold">
                  Phone <span className="font-normal text-slate-400">(optional)</span>
                  <input
                    value={phone}
                    onChange={(ev) => setPhone(ev.target.value)}
                    className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 font-normal text-slate-800"
                    autoComplete="tel"
                  />
                </label>
              </>
            )}

            {session !== 'checking' && (
            <label className="block mt-3 text-sm font-semibold">
              How many of you?
              <input
                type="number"
                min={1}
                max={20}
                value={quantity}
                onChange={(ev) => setQuantity(Math.max(1, Math.min(20, Number(ev.target.value) || 1)))}
                className="mt-1 w-24 rounded-xl border border-black/10 bg-white px-3 py-2 font-normal text-slate-800"
              />
            </label>
            )}

            {error && <p className="mt-4 text-sm font-semibold text-red-600">{error}</p>}

            <div className="mt-6 flex items-center gap-2">
              <button
                type="button"
                disabled={busy || session === 'checking' || (!signedIn && (!name.trim() || !email.trim()))}
                onClick={confirm}
                className="btn-glow ps-accentbg ps-btn text-sm font-semibold px-4 py-2 disabled:opacity-50"
                style={{ color: 'var(--ink)' }}
              >
                {busy ? 'Saving…' : 'Confirm my place'}
              </button>
              <button
                type="button"
                onClick={() => setJoining(null)}
                className="text-sm font-semibold px-4 py-2 rounded-xl hover:bg-black/5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
