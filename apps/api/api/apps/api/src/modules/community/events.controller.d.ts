import { EventsService } from './events.service';
import { RegistrationsService } from './registrations.service';
import { CreateEventDto, RegisterDto, SetRegistrationStatusDto, UpdateEventDto } from './community.dto';
export declare class EventsController {
    private readonly events;
    private readonly registrations;
    constructor(events: EventsService, registrations: RegistrationsService);
    list(): Promise<{
        status: import("@skoolos/db").$Enums.EventStatus;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        description: string | null;
        coverAssetId: string | null;
        startAt: Date;
        endAt: Date | null;
        venue: string | null;
        coverUrl: string | null;
        originSchoolName: string | null;
        scope: import("@skoolos/db").$Enums.EventScope;
        createdByUserId: string | null;
        approvedByUserId: string | null;
        approvedAt: Date | null;
    }[]>;
    create(dto: CreateEventDto): Promise<{
        status: import("@skoolos/db").$Enums.EventStatus;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        description: string | null;
        coverAssetId: string | null;
        startAt: Date;
        endAt: Date | null;
        venue: string | null;
        coverUrl: string | null;
        originSchoolName: string | null;
        scope: import("@skoolos/db").$Enums.EventScope;
        createdByUserId: string | null;
        approvedByUserId: string | null;
        approvedAt: Date | null;
    }>;
    update(id: string, dto: UpdateEventDto): Promise<{
        status: import("@skoolos/db").$Enums.EventStatus;
        id: string;
        createdAt: Date;
        schoolId: string;
        title: string;
        description: string | null;
        coverAssetId: string | null;
        startAt: Date;
        endAt: Date | null;
        venue: string | null;
        coverUrl: string | null;
        originSchoolName: string | null;
        scope: import("@skoolos/db").$Enums.EventScope;
        createdByUserId: string | null;
        approvedByUserId: string | null;
        approvedAt: Date | null;
    }>;
    remove(id: string): Promise<{
        ok: boolean;
    }>;
    /** Who is coming, with the counts the desk leads on. */
    listRegistrations(id: string): Promise<{
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
            seats: number;
        };
        registrations: {
            id: string;
            name: string;
            admissionNo: string | null;
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
     * An admin adding somebody by hand — a phone booking, a walk-in. The same
     * service the public route uses, so capacity and the waitlist behave
     * identically no matter which door the person came through.
     */
    addRegistration(id: string, dto: RegisterDto): Promise<{
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
    setRegistrationStatus(registrationId: string, dto: SetRegistrationStatusDto): Promise<{
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
//# sourceMappingURL=events.controller.d.ts.map