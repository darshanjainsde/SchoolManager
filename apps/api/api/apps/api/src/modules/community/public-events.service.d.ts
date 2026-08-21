import type { TenantTx } from '@skoolos/db';
import type { PublicEvent } from './community.dto';
/**
 * Events stay listed through the end of their (UTC) day, not until the exact
 * minute they start/end — otherwise a same-day event vanishes from every
 * school's page the moment it begins.
 */
export declare function eventsVisibleSince(now: Date): Date;
export declare class PublicEventsService {
    forHost(tx: TenantTx, hostSchoolId: string, now?: Date): Promise<PublicEvent[]>;
}
//# sourceMappingURL=public-events.service.d.ts.map