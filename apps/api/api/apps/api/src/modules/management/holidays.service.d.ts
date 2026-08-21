import { type Holiday } from '@skoolos/types';
import type { CreateHolidayDto } from './management.dto';
export type { Holiday };
export declare class HolidaysService {
    /**
     * Prisma types `Holiday.startDate`/`endDate` (`@db.Date`) as `Date`; the
     * shared `Holiday` contract (`@skoolos/types`) types them as ISO strings —
     * the shape every consumer (web, mobile) actually receives once Nest's
     * JSON serializer runs `Date.prototype.toJSON`. Converting here makes the
     * service's own return type match the wire contract instead of leaving the
     * two silently out of sync.
     */
    private static toRow;
    /**
     * Creates a school-configured holiday. `dto.type` already goes through
     * `@IsIn(HOLIDAY_TYPES)` at the controller boundary — this re-check is
     * defense in depth for any caller that reaches the service directly (unit
     * tests, future internal callers), mirroring `LeaveService.apply`'s own
     * `endDate < startDate` re-check ahead of `withTenant`.
     */
    create(schoolId: string, dto: CreateHolidayDto): Promise<Holiday>;
    /**
     * Upcoming holidays only — `startDate >= today` (IST calendar day, same
     * "today" boundary `LeaveService`/`PortalService` use elsewhere for
     * `@db.Date` comparisons) — ordered ascending so the nearest holiday is
     * first. The boundary is applied at the query itself, not filtered in JS
     * afterward, so a past holiday never leaves the database.
     */
    list(schoolId: string): Promise<Holiday[]>;
    remove(schoolId: string, id: string): Promise<{
        ok: true;
    }>;
}
//# sourceMappingURL=holidays.service.d.ts.map