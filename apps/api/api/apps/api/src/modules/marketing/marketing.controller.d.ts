import { MarketingService } from './marketing.service';
import { CreateLeadDto } from './marketing.dto';
/** Public endpoints backing the sckools.com marketing site. */
export declare class MarketingController {
    private readonly marketing;
    constructor(marketing: MarketingService);
    config(): Promise<import("./marketing.dto").PublicMarketingConfig>;
    createLead(dto: CreateLeadDto): Promise<{
        ok: true;
    }>;
}
//# sourceMappingURL=marketing.controller.d.ts.map