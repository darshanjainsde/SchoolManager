'use client';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';

/**
 * One event, and who is coming to it.
 *
 * Events could previously be written, approved and displayed — and that was the
 * end of them. There was no way to open one, because there was nothing behind
 * it: attendance was never modelled, so a school ran an open day and the system
 * that advertised it held no record anyone was coming.
 *
 * The page leads with SEATS, not rows. A family of four is one registration and
 * four chairs, and the number an admin needs when they look at a hall is the
 * second one.
 *
 * THERE IS NO PAYMENT UI HERE. Every ticket type is currently free, so every
 * registration confirms outright and carries `NOT_REQUIRED`. The money column
 * appears only if a row ever comes back with something owed — which nothing in
 * the product can currently produce. The door is built and shut.
 */

type RegistrationStatus = 'HELD' | 'CONFIRMED' | 'WAITLISTED' | 'DECLINED' | 'CANCELLED';

interface Registration {
  id: string;
  name: string;
  admissionNo: string | null;
  fromSchoolId: string | null;
  isGuest: boolean;
  email: string | null;
  phone: string | null;
  quantity: number;
  status: RegistrationStatus;
  paymentStatus: 'NOT_REQUIRED' | 'PENDING' | 'PAID' | 'REFUNDED';
  amountMinor: number;
  currency: string;
  waitlistPos: number | null;
  createdAt: string;
}

interface EventDesk {
  event: {
    id: string;
    title: string;
    startAt: string;
    endAt: string | null;
    venue: string | null;
    scope: 'SCHOOL' | 'NETWORK';
    status: string;
  };
  capacity: number | null;
  counts: {
    confirmed: number;
    held: number;
    waitlisted: number;
    declined: number;
    cancelled: number;
    seats: number;
  };
  registrations: Registration[];
}

const STATUS_TONE: Record<RegistrationStatus, string> = {
  CONFIRMED: 'good',
  HELD: 'warn',
  WAITLISTED: 'info',
  DECLINED: 'bad',
  CANCELLED: 'neutral',
};

const STATUS_LABEL: Record<RegistrationStatus, string> = {
  CONFIRMED: 'Coming',
  HELD: 'Awaiting confirmation',
  WAITLISTED: 'Waitlist',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
};

function when(startAt: string, endAt: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
  const s = new Date(startAt).toLocaleString(undefined, opts);
  return endAt ? `${s} – ${new Date(endAt).toLocaleString(undefined, opts)}` : s;
}

export default function EventDeskPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const host = useHost();
  const api = useApi({ audience: 'school', hostHeader: host });
  const qc = useQueryClient();

  const key = ['event-desk', id];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    enabled: !!host && !!id,
    queryFn: () => api.get<EventDesk>(`/manage/events/${id}/registrations`),
  });

  const setStatus = useMutation({
    mutationFn: (v: { registrationId: string; status: 'CONFIRMED' | 'DECLINED' }) =>
      api.patch(`/manage/events/registrations/${v.registrationId}`, { status: v.status }),
    onSuccess: (_r, v) => {
      toast.success(v.status === 'CONFIRMED' ? 'Confirmed.' : 'Declined.');
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts = data?.counts;
  // Waitlisted people are NOT seats — they are not taking up room, and folding
  // them into the headline would tell a school its hall is fuller than it is.
  const remaining =
    data?.capacity != null && counts ? Math.max(0, data.capacity - counts.seats) : null;

  return (
    <>
      <header className="sk-pagehead">
        <button type="button" className="sk-btn sk-press" onClick={() => router.push('/app/events')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All events
        </button>
        <h1 style={{ marginTop: 10 }}>{data?.event.title ?? 'Event'}</h1>
        {data && (
          <p>
            {when(data.event.startAt, data.event.endAt)}
            {data.event.venue ? ` · ${data.event.venue}` : ''}
            {data.event.scope === 'NETWORK' ? ' · shared across the network' : ''}
          </p>
        )}
      </header>

      {isLoading && <p className="sk-state">Opening…</p>}
      {!!error && <p className="sk-state err">{(error as Error).message}</p>}

      {data && counts && (
        <>
          <div className="sk-card">
            <div className="sk-card-h">
              <h3>Who is coming</h3>
              <span className="sp" />
              {/* The honest headline. "Seats" rather than "registrations",
                  because a family of four is one row and four chairs, and the
                  chairs are what has to fit in the hall. */}
              <span className="sk-pill" data-tone={remaining === 0 ? 'bad' : 'good'}>
                {counts.seats} {counts.seats === 1 ? 'seat' : 'seats'} taken
                {remaining != null ? ` · ${remaining} left` : ''}
              </span>
            </div>
            <div className="sk-card-b">
              <div className="sk-regstats" aria-hidden="true">
                <div className="sk-regstat" data-tone="good">
                  <div className="n">{counts.confirmed}</div>
                  <div className="l">coming</div>
                </div>
                <div className="sk-regstat" data-tone="warn">
                  <div className="n">{counts.held}</div>
                  <div className="l">to confirm</div>
                </div>
                <div className="sk-regstat">
                  <div className="n">{counts.waitlisted}</div>
                  <div className="l">waitlist</div>
                </div>
              </div>
              <p className="sk-state" style={{ padding: '8px 0 0' }}>
                {counts.confirmed} confirmed
                {counts.held > 0 ? `, ${counts.held} awaiting your confirmation` : ''}
                {counts.waitlisted > 0 ? `, ${counts.waitlisted} on the waitlist` : ''}
                {data.capacity == null ? ' · no seat limit set for this event.' : '.'}
              </p>
            </div>
          </div>

          <div className="sk-card">
            <div className="sk-card-h">
              <h3>Registrations</h3>
              <p className="sk-muted" style={{ marginTop: 4 }}>
                {data.registrations.length === 0
                  ? 'Nobody has registered yet.'
                  : `${data.registrations.length} ${data.registrations.length === 1 ? 'request' : 'requests'}`}
              </p>
            </div>
            <div className="sk-card-b">
              {data.registrations.length === 0 && (
                <p className="sk-state">
                  Nobody has registered yet. Registrations arrive here as soon as someone signs up on
                  the school website.
                </p>
              )}

              {data.registrations.map((r) => (
                <div key={r.id} className="sk-row" data-testid={`reg-${r.id}`}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm">
                      {r.name}
                      {r.quantity > 1 && (
                        <span className="meta" style={{ marginLeft: 8 }}>
                          {r.quantity} seats
                        </span>
                      )}
                    </div>
                    <div className="meta">
                      {/* Which school somebody came from is the first thing an
                          admin asks about a network registration, so it sits on
                          the row rather than behind a detail view. */}
                      {r.admissionNo
                        ? `Our school · ${r.admissionNo}`
                        : r.fromSchoolId
                          ? 'From another school in the network'
                          : 'Guest'}
                      {r.email ? ` · ${r.email}` : ''}
                      {r.waitlistPos ? ` · queue #${r.waitlistPos}` : ''}
                    </div>
                  </div>
                  <span className="sp" />

                  {/* Money is shown ONLY if something is actually owed. Nothing
                      in the product can currently produce that, so this stays
                      invisible rather than showing every row a hopeful "Free". */}
                  {r.paymentStatus === 'PENDING' && (
                    <span className="sk-pill" data-tone="warn">
                      {r.currency} {(r.amountMinor / 100).toFixed(2)} due
                    </span>
                  )}

                  <span className="sk-pill" data-tone={STATUS_TONE[r.status]}>
                    {STATUS_LABEL[r.status]}
                  </span>

                  {(r.status === 'HELD' || r.status === 'WAITLISTED') && (
                    <button
                      type="button"
                      className="sk-btn sk-press"
                      data-variant="primary"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ registrationId: r.id, status: 'CONFIRMED' })}
                    >
                      Confirm
                    </button>
                  )}
                  {r.status !== 'DECLINED' && r.status !== 'CANCELLED' && (
                    <button
                      type="button"
                      className="sk-btn sk-press"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ registrationId: r.id, status: 'DECLINED' })}
                    >
                      Decline
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
