import { Injectable } from '@nestjs/common';
import type { TenantTx } from '@skoolos/db';
import type { PublicEvent } from './community.dto';

/**
 * Events stay listed through the end of their (UTC) day, not until the exact
 * minute they start/end — otherwise a same-day event vanishes from every
 * school's page the moment it begins.
 */
export function eventsVisibleSince(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class PublicEventsService {
  // Runs inside the caller's withTenant(hostSchoolId) transaction. RLS returns
  // the host's own rows (tenant_iso) OR any NETWORK+APPROVED row (read_network_events).
  async forHost(tx: TenantTx, hostSchoolId: string, now: Date = new Date()): Promise<PublicEvent[]> {
    const since = eventsVisibleSince(now);
    const rows = await tx.event.findMany({
      where: {
        status: 'APPROVED',
        OR: [{ scope: 'SCHOOL' }, { scope: 'NETWORK' }],
        AND: { OR: [{ endAt: { gte: since } }, { endAt: null, startAt: { gte: since } }] },
      },
      orderBy: { startAt: 'asc' },
    });
    if (rows.length === 0) return [];

    const eventIds = rows.map((e) => e.id);
    // The ticket a public join registers against is the earliest one — the same
    // choice RegistrationsService makes when no ticket is named, so the page
    // cannot advertise a different ticket from the one the booking uses.
    const ticketTypes = await tx.eventTicketType.findMany({
      where: { eventId: { in: eventIds } },
      orderBy: { createdAt: 'asc' },
    });
    const ticketFor = new Map<string, (typeof ticketTypes)[number]>();
    for (const t of ticketTypes) if (!ticketFor.has(t.eventId)) ticketFor.set(t.eventId, t);

    // Only the host's own events can be counted: RLS hides another school's
    // attendee list, so asking for it would produce a confidently wrong number.
    const ownIds = rows.filter((e) => e.schoolId === hostSchoolId).map((e) => e.id);
    const taken = new Map<string, number>();
    if (ownIds.length > 0) {
      const held = await tx.eventRegistration.findMany({
        where: { eventId: { in: ownIds }, status: { in: ['HELD', 'CONFIRMED'] } },
        select: { eventId: true, quantity: true },
      });
      for (const r of held) taken.set(r.eventId, (taken.get(r.eventId) ?? 0) + r.quantity);
    }

    return rows.map((e) => {
      const ticket = ticketFor.get(e.id) ?? null;
      const isHost = e.schoolId === hostSchoolId;
      const capacity = ticket?.capacity ?? null;
      // Unknown for an uncapped event AND for anyone else's. A negative number
      // is never shown: an oversold hall has no seats left, not minus three.
      const seatsLeft = isHost && capacity != null ? Math.max(0, capacity - (taken.get(e.id) ?? 0)) : null;

      const windowOpen =
        !!ticket &&
        (!ticket.salesOpenAt || ticket.salesOpenAt <= now) &&
        (!ticket.salesCloseAt || ticket.salesCloseAt >= now);

      return {
        id: e.id,
        title: e.title,
        description: e.description,
        coverUrl: e.coverUrl,
        startAt: e.startAt.toISOString(),
        endAt: e.endAt ? e.endAt.toISOString() : null,
        venue: e.venue,
        scope: e.scope as 'SCHOOL' | 'NETWORK',
        originSchoolName: e.scope === 'NETWORK' ? e.originSchoolName : null,
        isHost,
        ticketTypeId: ticket?.id ?? null,
        capacity,
        seatsLeft,
        // Open even at zero seats: past capacity the engine waitlists rather
        // than refusing, and a queue is information the school can act on where
        // a closed door is not. The page says "join the waitlist" instead.
        //
        // Only on the host's OWN events, though. A cross-school join would
        // count seats from rows RLS hides — i.e. oversell somebody else's hall
        // — so those link out to the school that runs them.
        registrationOpen: isHost && windowOpen,
        priceMinor: ticket?.priceMinor ?? 0,
        currency: ticket?.currency ?? 'INR',
      };
    });
  }
}
