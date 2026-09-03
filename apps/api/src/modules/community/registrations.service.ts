import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import type { PublicRegisterDto, RegisterDto } from './community.dto';
import { LIST_CEILING } from '../../common/lists/list-ceiling';

/**
 * Who is coming to an event.
 *
 * The events feature could previously advertise an event and nothing else — a
 * school ran an open day, sixty families turned up unannounced, and the system
 * that published it held no record anyone was ever coming. This is the half
 * that was missing.
 *
 * THE PAYMENT DOOR IS BUILT AND SHUT. Every ticket type currently costs zero,
 * so every registration is `NOT_REQUIRED` and confirms without money changing
 * hands. The paid branch is not a separate code path waiting to be written
 * later; it is the same path with a non-zero price, which is what stops it
 * rotting before it is ever used. Nothing here talks to a payment provider and
 * nothing charges anybody.
 */
@Injectable()
export class RegistrationsService {
  constructor(private readonly tenant: TenantContextService) {}

  /**
   * Capacity is counted inside the same transaction as the insert.
   *
   * Two families registering for the last seat at the same moment is not a
   * hypothetical on an open-day link shared to a WhatsApp group — it is the
   * normal case. Counting outside the transaction would let both through and
   * oversell the hall.
   */
  private async seatsTaken(tx: TenantTxLike, ticketTypeId: string): Promise<number> {
    // Summed in the database, not in this process.
    //
    // This read decides whether a seat is free, so it must be EXACT. Fetching
    // rows and adding them up is exact only while every row fits in one read —
    // a row ceiling here would silently undercount a popular event and oversell
    // the hall, which is the precise failure the surrounding transaction exists
    // to prevent. An aggregate has no such ceiling to reach.
    const agg = await tx.eventRegistration.aggregate({
      where: { ticketTypeId, status: { in: ['HELD', 'CONFIRMED'] } },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }

  /** The host's own view: every registration for one of its events. */
  async listForEvent(eventId: string) {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId, schoolId } });
      if (!event) throw new NotFoundException('Event not found');

      const [rows, ticketTypes] = await Promise.all([
        tx.eventRegistration.findMany({ take: LIST_CEILING.ACTIVITY,
          where: { eventId, schoolId },
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        }),
        tx.eventTicketType.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId, eventId }, orderBy: { createdAt: 'asc' } }),
      ]);

      // Student names are resolved separately: a registration may reference a
      // student of ANOTHER school (a network event), and that row is not
      // readable from this tenant. An unresolvable name is reported as the
      // school it came from rather than left blank, because "someone from
      // Bloom Public" is useful and an empty row is not.
      const studentIds = rows.map((r) => r.studentId).filter((x): x is string => !!x);
      const students = studentIds.length
        ? await tx.student.findMany({ take: LIST_CEILING.ROSTER,
            where: { id: { in: studentIds } },
            select: { id: true, firstName: true, lastName: true, admissionNo: true },
          })
        : [];
      const byId = new Map(students.map((s) => [s.id, s]));

      const counts = {
        confirmed: rows.filter((r) => r.status === 'CONFIRMED').reduce((n, r) => n + r.quantity, 0),
        held: rows.filter((r) => r.status === 'HELD').reduce((n, r) => n + r.quantity, 0),
        waitlisted: rows.filter((r) => r.status === 'WAITLISTED').reduce((n, r) => n + r.quantity, 0),
        declined: rows.filter((r) => r.status === 'DECLINED').length,
        cancelled: rows.filter((r) => r.status === 'CANCELLED').length,
        /** People, not rows — a family of four is one row and four seats. */
        seats: rows
          .filter((r) => r.status === 'HELD' || r.status === 'CONFIRMED')
          .reduce((n, r) => n + r.quantity, 0),
      };

      return {
        event: {
          id: event.id,
          title: event.title,
          // description and coverArt are here for the Promo Kit, which draws
          // its poster from this same payload rather than asking for a second
          // fetch of a row the desk has already loaded.
          description: event.description,
          coverArt: event.coverArt,
          startAt: event.startAt.toISOString(),
          endAt: event.endAt?.toISOString() ?? null,
          venue: event.venue,
          scope: event.scope,
          status: event.status,
        },
        capacity: ticketTypes.reduce<number | null>(
          (acc, t) => (t.capacity == null || acc == null ? null : acc + t.capacity),
          0,
        ),
        counts,
        registrations: rows.map((r) => {
          const s = r.studentId ? byId.get(r.studentId) : undefined;
          return {
            id: r.id,
            name: s ? `${s.firstName} ${s.lastName}`.trim() : (r.guestName ?? 'Someone from another school'),
            admissionNo: s?.admissionNo ?? null,
            /** Null means our own school; a name means they came from elsewhere. */
            fromSchoolId: r.fromSchoolId,
            isGuest: !r.studentId,
            email: r.guestEmail,
            phone: r.guestPhone,
            quantity: r.quantity,
            status: r.status,
            paymentStatus: r.paymentStatus,
            amountMinor: r.amountMinor,
            currency: r.currency,
            waitlistPos: r.waitlistPos,
            checkedInAt: r.checkedInAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
          };
        }),
      };
    });
  }

  /**
   * The public front door.
   *
   * Narrower than `register` on purpose. It runs the SAME path, so capacity and
   * the waitlist cannot behave one way for a parent and another for the office,
   * but it trusts nothing the caller says about who they are:
   *
   *   - `studentId` is ignored outright. A stranger cannot claim to be a pupil.
   *   - `fromSchoolId` is forced to this tenant, not read from the body.
   *   - the event must be one THIS school hosts. A network event is readable
   *     here, but its registrations are not (RLS `read_own_outbound_...`), so a
   *     public join would count seats from rows we cannot see and oversell
   *     somebody else's hall. Those events link out to the school running them.
   */
  async registerPublicly(eventId: string, dto: PublicRegisterDto) {
    const { schoolId } = this.tenant.requireTenant();
    const row = await this.register(eventId, {
      quantity: dto.quantity,
      guestName: dto.guestName,
      guestEmail: dto.guestEmail,
      guestPhone: dto.guestPhone,
      fromSchoolId: schoolId,
      requireHostedBy: schoolId,
    });
    return {
      id: row.id,
      status: row.status,
      waitlistPos: row.waitlistPos ?? null,
      quantity: row.quantity,
    };
  }

  /**
   * Register somebody. Runs for the HOST tenant — the host owns its attendee
   * list, which is the decision the RLS policies rest on.
   */
  async register(eventId: string, dto: RegisterDto & { requireHostedBy?: string }) {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const event = await tx.event.findFirst({ where: { id: eventId } });
      if (!event) throw new NotFoundException('Event not found');
      if (dto.requireHostedBy && event.schoolId !== dto.requireHostedBy) {
        throw new BadRequestException('That event is run by another school — register on their own site');
      }
      if (event.status !== 'APPROVED') {
        throw new BadRequestException('That event is not open for registration yet');
      }

      const ticket = dto.ticketTypeId
        ? await tx.eventTicketType.findFirst({ where: { schoolId, id: dto.ticketTypeId, eventId } })
        : await tx.eventTicketType.findFirst({ where: { schoolId, eventId }, orderBy: { createdAt: 'asc' } });
      if (!ticket) throw new BadRequestException('That event has no ticket type to register against');

      const now = new Date();
      if (ticket.salesOpenAt && ticket.salesOpenAt > now) {
        throw new BadRequestException('Registration has not opened yet');
      }
      if (ticket.salesCloseAt && ticket.salesCloseAt < now) {
        throw new BadRequestException('Registration has closed');
      }

      const quantity = dto.quantity ?? 1;
      const taken = await this.seatsTaken(tx, ticket.id);
      const overCapacity = ticket.capacity != null && taken + quantity > ticket.capacity;

      // Past capacity the honest answer is a place in the queue with a number
      // on it, not a refusal — a refusal loses the person entirely, and a
      // waitlist is information the school can act on.
      const waitlisted = overCapacity;
      const waitlistPos = waitlisted
        ? (await tx.eventRegistration.count({ where: { schoolId, eventId, status: 'WAITLISTED' } })) + 1
        : null;

      const amountMinor = ticket.priceMinor * quantity;
      // A free event is not a separate path: price zero, payment NOT_REQUIRED,
      // and it confirms immediately. A paid one is HELD until the money is
      // recorded — today by an admin, later by a gateway, same row either way.
      const free = amountMinor === 0;

      return tx.eventRegistration.create({
        data: {
          eventId,
          schoolId: event.schoolId,
          ticketTypeId: ticket.id,
          quantity,
          // Forced null on the public path: `registerPublicly` never forwards a
          // studentId, so a stranger cannot file a place as somebody's child.
          studentId: dto.studentId ?? null,
          fromSchoolId: dto.fromSchoolId ?? schoolId,
          guestName: dto.guestName ?? null,
          guestEmail: dto.guestEmail ?? null,
          guestPhone: dto.guestPhone ?? null,
          status: waitlisted ? 'WAITLISTED' : free ? 'CONFIRMED' : 'HELD',
          waitlistPos,
          amountMinor,
          currency: ticket.currency,
          paymentStatus: free ? 'NOT_REQUIRED' : 'PENDING',
        },
      });
    });
  }

  /** The host confirming or turning down a request. */
  async setStatus(registrationId: string, status: 'CONFIRMED' | 'DECLINED' | 'CANCELLED') {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.eventRegistration.findFirst({
        where: { id: registrationId, schoolId },
      });
      if (!existing) throw new NotFoundException('Registration not found');
      return tx.eventRegistration.update({ where: { id: registrationId }, data: { status } });
    });
  }
}

/**
 * The slice of the tenant transaction this service touches.
 *
 * Declared locally rather than importing the full generated client type: it
 * keeps the capacity helper testable with a small hand-built stub, and makes
 * the surface this service is allowed to reach explicit.
 */
interface TenantTxLike {
  eventRegistration: {
    findMany(args: unknown): Promise<{ quantity: number }[]>;
    /**
     * Sums seats in the database — see seatsTaken for why this must not page.
     *
     * Loosely typed on purpose: Prisma's generated aggregate signature is far
     * wider than this shim needs, and pinning it here makes the real client
     * un-assignable. The shim exists so the unit tests can pass a plain object,
     * not to re-describe Prisma.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    aggregate(args: any): Promise<any>;
  };
}
