import { TenantContextService } from '../tenancy';
import type { PublicRegisterDto, RegisterDto } from './community.dto';
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
export declare class RegistrationsService {
    private readonly tenant;
    constructor(tenant: TenantContextService);
    /**
     * Capacity is counted inside the same transaction as the insert.
     *
     * Two families registering for the last seat at the same moment is not a
     * hypothetical on an open-day link shared to a WhatsApp group — it is the
     * normal case. Counting outside the transaction would let both through and
     * oversell the hall.
     */
    private seatsTaken;
    /** The host's own view: every registration for one of its events. */
    listForEvent(eventId: string): Promise<{
        event: {
            id: string;
            title: string;
            startAt: string;
            endAt: string | null;
            venue: string | null;
            scope: import("@skoolos/db").$Enums.EventScope;
            status: import("@skoolos/db").$Enums.EventStatus;
        };
        capacity: number | null;
        counts: {
            confirmed: number;
            held: number;
            waitlisted: number;
            declined: number;
            cancelled: number;
            /** People, not rows — a family of four is one row and four seats. */
            seats: number;
        };
        registrations: {
            id: string;
            name: string;
            admissionNo: string | null;
            /** Null means our own school; a name means they came from elsewhere. */
            fromSchoolId: string | null;
            isGuest: boolean;
            email: string | null;
            phone: string | null;
            quantity: number;
            status: import("@skoolos/db").$Enums.RegistrationStatus;
            paymentStatus: import("@skoolos/db").$Enums.PaymentStatus;
            amountMinor: number;
            currency: string;
            waitlistPos: number | null;
            checkedInAt: string | null;
            createdAt: string;
        }[];
    }>;
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
    registerPublicly(eventId: string, dto: PublicRegisterDto): Promise<{
        id: string;
        status: import("@skoolos/db").$Enums.RegistrationStatus;
        waitlistPos: number | null;
        quantity: number;
    }>;
    /**
     * Register somebody. Runs for the HOST tenant — the host owns its attendee
     * list, which is the decision the RLS policies rest on.
     */
    register(eventId: string, dto: RegisterDto & {
        requireHostedBy?: string;
    }): Promise<{
        status: import("@skoolos/db").$Enums.RegistrationStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        schoolId: string;
        studentId: string | null;
        eventId: string;
        ticketTypeId: string;
        quantity: number;
        fromSchoolId: string | null;
        guestName: string | null;
        guestEmail: string | null;
        guestPhone: string | null;
        amountMinor: number;
        currency: string;
        paymentStatus: import("@skoolos/db").$Enums.PaymentStatus;
        waitlistPos: number | null;
        checkedInAt: Date | null;
    }>;
    /** The host confirming or turning down a request. */
    setStatus(registrationId: string, status: 'CONFIRMED' | 'DECLINED' | 'CANCELLED'): Promise<{
        status: import("@skoolos/db").$Enums.RegistrationStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        schoolId: string;
        studentId: string | null;
        eventId: string;
        ticketTypeId: string;
        quantity: number;
        fromSchoolId: string | null;
        guestName: string | null;
        guestEmail: string | null;
        guestPhone: string | null;
        amountMinor: number;
        currency: string;
        paymentStatus: import("@skoolos/db").$Enums.PaymentStatus;
        waitlistPos: number | null;
        checkedInAt: Date | null;
    }>;
}
//# sourceMappingURL=registrations.service.d.ts.map