export declare class CreateEventDto {
    title: string;
    description?: string;
    coverAssetId?: string;
    startAt: string;
    endAt?: string;
    venue?: string;
    scope: 'SCHOOL' | 'NETWORK';
    /** Seats available. Omitted means unlimited — no number is invented. */
    capacity?: number;
}
export declare class UpdateEventDto {
    title?: string;
    description?: string;
    coverAssetId?: string;
    startAt?: string;
    endAt?: string;
    venue?: string;
}
export interface PublicEvent {
    id: string;
    title: string;
    description: string | null;
    coverUrl: string | null;
    startAt: string;
    endAt: string | null;
    venue: string | null;
    scope: 'SCHOOL' | 'NETWORK';
    originSchoolName: string | null;
    isHost: boolean;
    /** The ticket a public join registers against. Null = nothing to join. */
    ticketTypeId: string | null;
    /** null = uncapped. 0 is a real value: sold out by configuration. */
    capacity: number | null;
    /**
     * null means UNKNOWN, not unlimited — either the event is uncapped, or it
     * belongs to another school whose registrations RLS correctly hides from us.
     */
    seatsLeft: number | null;
    /** Whether the public Join button should be offered at all. */
    registrationOpen: boolean;
    priceMinor: number;
    currency: string;
}
/**
 * Registering somebody for an event.
 *
 * Either a signed-in student or a guest — the database enforces that at least
 * one identifies the row, because a registration nobody can be told about is
 * worse than a rejected one.
 */
export declare class RegisterDto {
    ticketTypeId?: string;
    quantity?: number;
    studentId?: string;
    fromSchoolId?: string;
    guestName?: string;
    guestEmail?: string;
    guestPhone?: string;
}
/**
 * What a visitor on the public site may say about themselves — and nothing
 * more. There is deliberately no `studentId` and no `fromSchoolId` here: the
 * admin `RegisterDto` has them because an authenticated office is trusted to
 * name a pupil, and a stranger on the internet is not. Adding either field to
 * this class is how that distinction would be lost.
 */
export declare class PublicRegisterDto {
    guestName: string;
    guestEmail: string;
    guestPhone?: string;
    quantity?: number;
}
export declare class SetRegistrationStatusDto {
    status: 'CONFIRMED' | 'DECLINED' | 'CANCELLED';
}
//# sourceMappingURL=community.dto.d.ts.map