'use client';
import Link from 'next/link';
import { EventArt, guessArt, type ArtKey } from './event-art';

export type EventScope = 'SCHOOL' | 'NETWORK';
export type EventStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SchoolEvent {
  id: string;
  title: string;
  description?: string | null;
  startAt: string;
  endAt?: string | null;
  venue?: string | null;
  scope: EventScope;
  status: EventStatus;
  coverArt?: string | null;
  coverAssetId?: string | null;
  coverUrl?: string | null;
  /** Which band of a tall photo the 16:9 tile keeps. */
  coverFocus?: 'top' | 'middle' | 'bottom' | null;
  originSchoolName?: string | null;
  createdAt: string;
}

const STATUS: Record<EventStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PENDING: { label: 'Awaiting approval', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'good' },
  REJECTED: { label: 'Not approved', tone: 'bad' },
};

export function artOf(e: { coverArt?: string | null; title: string }): ArtKey {
  return (e.coverArt as ArtKey | null) ?? guessArt(e.title);
}

export function whenLine(startAt: string, endAt?: string | null): string {
  const s = new Date(startAt);
  if (Number.isNaN(s.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata',
  };
  const start = s.toLocaleString('en-IN', opts);
  if (!endAt) return start;
  const e = new Date(endAt);
  if (Number.isNaN(e.getTime())) return start;
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? `${start} – ${e.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
    : `${start} → ${e.toLocaleString('en-IN', opts)}`;
}

/**
 * One event, as a card.
 *
 * The date sits ON the artwork because that is the only thing anyone scans an
 * events list for — a list of titles makes you read every row to find next
 * Tuesday. The actions sit in their own strip below so a long title cannot
 * push Delete off a phone.
 *
 * `coverUrl` (an uploaded photo) wins when a school has one; the drawn art is
 * what every other event gets, which is most of them.
 */
export function EventCard({
  event,
  past,
  onDelete,
  deleting,
}: {
  event: SchoolEvent;
  past?: boolean;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const status = STATUS[event.status] ?? STATUS.DRAFT;
  const start = new Date(event.startAt);
  const day = Number.isNaN(start.getTime()) ? '—' : String(start.getDate()).padStart(2, '0');
  const month = Number.isNaN(start.getTime())
    ? ''
    : start.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' });

  return (
    <article className="sk-ev-card" data-past={past ? 'true' : undefined}>
      <div className="sk-ev-cover">
        {event.coverUrl ? (
          /* A tenant-uploaded URL on an arbitrary host: next/image would need
             every school's domain in remotePatterns, which is not knowable. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.coverUrl} alt="" data-focus={event.coverFocus ?? 'middle'} loading="lazy" decoding="async" />
        ) : (
          <EventArt kind={artOf(event)} />
        )}
        <span className="sk-ev-when">
          <span className="d">{day}</span>
          <span className="m">{month}</span>
        </span>
      </div>

      <div className="sk-ev-body">
        <h3 className="sk-ev-title">{event.title}</h3>
        <div className="sk-ev-meta">
          <span>{whenLine(event.startAt, event.endAt)}</span>
          {event.venue ? <span>{event.venue}</span> : null}
        </div>
        {event.description ? <p className="sk-ev-blurb">{event.description}</p> : null}
        <div className="sk-ev-pills">
          <span className="sk-pill" data-tone="neutral">
            {event.scope === 'NETWORK' ? 'Network' : 'Our school'}
          </span>
          <span className="sk-pill" data-tone={status.tone}>{status.label}</span>
        </div>
      </div>

      <div className="sk-ev-acts">
        <Link className="sk-btn" data-size="sm" data-variant="primary" href={`/app/events/${event.id}/promo`}>
          Promo Kit
        </Link>
        <Link className="sk-btn" data-size="sm" href={`/app/events/${event.id}`}>
          Who’s coming
        </Link>
        {onDelete ? (
          <button className="sk-btn" data-size="sm" type="button" onClick={onDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        ) : null}
      </div>
    </article>
  );
}
