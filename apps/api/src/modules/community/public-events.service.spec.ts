import { eventsVisibleSince, PublicEventsService } from './public-events.service';

describe('eventsVisibleSince', () => {
  it('returns the start of the current UTC day, not the current instant', () => {
    // Regression: a NETWORK event approved for "today 1:55 PM" vanished from
    // every school at 1:55 PM sharp because the filter compared against now().
    // Events must stay listed through the end of their day.
    const now = new Date('2026-07-12T08:36:02Z'); // 2:06 PM IST
    const cutoff = eventsVisibleSince(now);
    expect(cutoff.toISOString()).toBe('2026-07-12T00:00:00.000Z');

    const eventEnd = new Date('2026-07-12T08:25:00Z'); // ended 11 min "ago"
    expect(eventEnd.getTime()).toBeGreaterThanOrEqual(cutoff.getTime()); // still visible
  });

  it('hides events from previous days', () => {
    const cutoff = eventsVisibleSince(new Date('2026-07-12T08:36:02Z'));
    expect(new Date('2026-07-11T23:59:00Z').getTime()).toBeLessThan(cutoff.getTime());
  });
});

/**
 * SEATS BESIDE THE BUTTON.
 *
 * A Join button that cannot say whether anywhere is left is a button that
 * sends people to a hall which filled up on Tuesday. The public page therefore
 * needs the three facts the admin desk already has: is there a ticket to
 * register against, is the window open, and how many seats remain.
 *
 * The one fact it CANNOT have is how full somebody else's event is. RLS lets a
 * visitor read a network event and its ticket type, but registrations belong to
 * the host — `read_own_outbound_registrations` scopes reads to rows the
 * caller's own school produced. A seat count for another school's event would
 * therefore be computed from rows we cannot see, which is worse than no number.
 */

const HOST = 'school-host';
const OTHER = 'school-other';
const NOW = new Date('2026-08-05T09:00:00Z');

interface Row {
  id: string;
  schoolId: string;
  title: string;
  description: string | null;
  coverUrl: string | null;
  startAt: Date;
  endAt: Date | null;
  venue: string | null;
  scope: string;
  status: string;
  originSchoolName: string | null;
}

function eventRow(over: Partial<Row> & { id: string; schoolId: string }): Row {
  return {
    title: 'Open Day',
    description: null,
    coverUrl: null,
    startAt: new Date('2026-08-20T04:30:00Z'),
    endAt: null,
    venue: 'Main hall',
    scope: 'SCHOOL',
    status: 'APPROVED',
    originSchoolName: null,
    ...over,
  };
}

/**
 * A stand-in for the tenant transaction that answers only what RLS would
 * actually let this tenant see — registrations belonging to OTHER schools are
 * withheld, because that is the constraint the seat count has to live inside.
 */
function txFor(opts: {
  events: Row[];
  ticketTypes?: {
    id: string;
    eventId: string;
    capacity: number | null;
    priceMinor?: number;
    currency?: string;
    salesOpenAt?: Date | null;
    salesCloseAt?: Date | null;
  }[];
  registrations?: { eventId: string; schoolId: string; quantity: number; status: string }[];
}) {
  const ticketTypes = opts.ticketTypes ?? [];
  const registrations = opts.registrations ?? [];
  return {
    event: { findMany: async () => opts.events },
    eventTicketType: {
      findMany: async ({ where }: { where: { eventId: { in: string[] } } }) =>
        ticketTypes
          .filter((t) => where.eventId.in.includes(t.eventId))
          .map((t) => ({
            id: t.id,
            eventId: t.eventId,
            capacity: t.capacity,
            priceMinor: t.priceMinor ?? 0,
            currency: t.currency ?? 'INR',
            salesOpenAt: t.salesOpenAt ?? null,
            salesCloseAt: t.salesCloseAt ?? null,
            createdAt: new Date('2026-08-01T00:00:00Z'),
          })),
    },
    eventRegistration: {
      findMany: async ({ where }: { where: { eventId: { in: string[] } } }) =>
        registrations
          .filter((r) => where.eventId.in.includes(r.eventId) && r.schoolId === HOST)
          .filter((r) => r.status === 'HELD' || r.status === 'CONFIRMED')
          .map((r) => ({ eventId: r.eventId, quantity: r.quantity })),
    },
  };
}

// The stub answers only the slice forHost touches; the cast keeps it honest at
// the call site rather than widening the service's own parameter type.
const asTx = (tx: unknown) => tx as Parameters<PublicEventsService['forHost']>[0];

describe('what the public page is told about registering', () => {
  const service = new PublicEventsService();

  it('reports the seats left on the school’s own event', async () => {
    const tx = txFor({
      events: [eventRow({ id: 'e1', schoolId: HOST })],
      ticketTypes: [{ id: 't1', eventId: 'e1', capacity: 50 }],
      registrations: [
        { eventId: 'e1', schoolId: HOST, quantity: 4, status: 'CONFIRMED' },
        { eventId: 'e1', schoolId: HOST, quantity: 2, status: 'HELD' },
      ],
    });
    const [e] = await service.forHost(asTx(tx), HOST, NOW);
    expect(e.capacity).toBe(50);
    expect(e.seatsLeft).toBe(44);
    expect(e.ticketTypeId).toBe('t1');
    expect(e.registrationOpen).toBe(true);
  });

  it('counts a cancelled or waitlisted place as a seat still free', async () => {
    const tx = txFor({
      events: [eventRow({ id: 'e1', schoolId: HOST })],
      ticketTypes: [{ id: 't1', eventId: 'e1', capacity: 10 }],
      registrations: [
        { eventId: 'e1', schoolId: HOST, quantity: 3, status: 'CONFIRMED' },
        { eventId: 'e1', schoolId: HOST, quantity: 5, status: 'CANCELLED' },
        { eventId: 'e1', schoolId: HOST, quantity: 2, status: 'WAITLISTED' },
      ],
    });
    const [e] = await service.forHost(asTx(tx), HOST, NOW);
    expect(e.seatsLeft).toBe(7);
  });

  it('says nothing is left rather than a negative number when an event oversold', async () => {
    const tx = txFor({
      events: [eventRow({ id: 'e1', schoolId: HOST })],
      ticketTypes: [{ id: 't1', eventId: 'e1', capacity: 2 }],
      registrations: [{ eventId: 'e1', schoolId: HOST, quantity: 5, status: 'CONFIRMED' }],
    });
    const [e] = await service.forHost(asTx(tx), HOST, NOW);
    expect(e.seatsLeft).toBe(0);
  });

  it('stays open when the hall is full, because a queue is more use than a closed door', async () => {
    // The engine waitlists past capacity rather than refusing. Reporting a full
    // event as closed would throw away the one thing the school can act on: the
    // list of families who still want to come.
    const tx = txFor({
      events: [eventRow({ id: 'e1', schoolId: HOST })],
      ticketTypes: [{ id: 't1', eventId: 'e1', capacity: 2 }],
      registrations: [{ eventId: 'e1', schoolId: HOST, quantity: 2, status: 'CONFIRMED' }],
    });
    const [e] = await service.forHost(asTx(tx), HOST, NOW);
    expect(e.seatsLeft).toBe(0);
    expect(e.registrationOpen).toBe(true);
  });

  it('leaves seats unknown for an uncapped event, which is not the same as full', async () => {
    const tx = txFor({
      events: [eventRow({ id: 'e1', schoolId: HOST })],
      ticketTypes: [{ id: 't1', eventId: 'e1', capacity: null }],
    });
    const [e] = await service.forHost(asTx(tx), HOST, NOW);
    expect(e.capacity).toBeNull();
    expect(e.seatsLeft).toBeNull();
    expect(e.registrationOpen).toBe(true);
  });

  it('refuses to guess the seat count of another school’s event, which RLS hides', async () => {
    const tx = txFor({
      events: [eventRow({ id: 'e2', schoolId: OTHER, scope: 'NETWORK', originSchoolName: 'Bloom Public' })],
      ticketTypes: [{ id: 't2', eventId: 'e2', capacity: 30 }],
      // These rows exist at the host school; this tenant cannot read them.
      registrations: [{ eventId: 'e2', schoolId: OTHER, quantity: 25, status: 'CONFIRMED' }],
    });
    const [e] = await service.forHost(asTx(tx), HOST, NOW);
    expect(e.isHost).toBe(false);
    expect(e.seatsLeft).toBeNull();
    // And so the public door stays shut on it: a join we cannot count is a
    // join that can oversell somebody else's hall.
    expect(e.registrationOpen).toBe(false);
  });

  it('is closed when the sales window has not opened or has already shut', async () => {
    const tx = txFor({
      events: [eventRow({ id: 'e1', schoolId: HOST }), eventRow({ id: 'e2', schoolId: HOST })],
      ticketTypes: [
        { id: 't1', eventId: 'e1', capacity: null, salesOpenAt: new Date('2026-09-01T00:00:00Z') },
        { id: 't2', eventId: 'e2', capacity: null, salesCloseAt: new Date('2026-08-01T00:00:00Z') },
      ],
    });
    const [notYet, closed] = await service.forHost(asTx(tx), HOST, NOW);
    expect(notYet.registrationOpen).toBe(false);
    expect(closed.registrationOpen).toBe(false);
  });

  it('is closed when nobody set up a ticket type to register against', async () => {
    const tx = txFor({ events: [eventRow({ id: 'e1', schoolId: HOST })], ticketTypes: [] });
    const [e] = await service.forHost(asTx(tx), HOST, NOW);
    expect(e.ticketTypeId).toBeNull();
    expect(e.registrationOpen).toBe(false);
  });

  it('carries the price so a paid event cannot look free', async () => {
    const tx = txFor({
      events: [eventRow({ id: 'e1', schoolId: HOST })],
      ticketTypes: [{ id: 't1', eventId: 'e1', capacity: null, priceMinor: 25000, currency: 'INR' }],
    });
    const [e] = await service.forHost(asTx(tx), HOST, NOW);
    expect(e.priceMinor).toBe(25000);
    expect(e.currency).toBe('INR');
  });
});
