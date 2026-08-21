import { RegistrationsService } from './registrations.service';
import { PublicRegisterDto } from './community.dto';
/**
 * The way in from a school's own website.
 *
 * Everything the registration engine could do was behind an admin login, so a
 * school could publish an open day and nobody could sign up for it. The tenant
 * comes from the request host (the same middleware every public route uses),
 * never from the body.
 *
 * Throttled to 5 a minute per IP — the same budget as the enquiry form. A
 * public POST that writes a row is exactly what a bored script finds first, and
 * an event with three hundred fake families on the list is as useless to the
 * school as an empty one.
 */
export declare class PublicRegistrationController {
    private readonly registrations;
    constructor(registrations: RegistrationsService);
    register(id: string, dto: PublicRegisterDto): Promise<{
        id: string;
        status: import("@skoolos/db").$Enums.RegistrationStatus;
        waitlistPos: number | null;
        quantity: number;
    }>;
}
//# sourceMappingURL=public-registration.controller.d.ts.map