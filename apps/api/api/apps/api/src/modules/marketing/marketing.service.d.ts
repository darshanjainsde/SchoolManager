import type { MarketingConfig, MarketingLead } from '@skoolos/db';
import { MailService } from '../../common/mail/mail.service';
import { CreateLeadDto, PublicMarketingConfig, UpdateMarketingConfigDto } from './marketing.dto';
/**
 * Platform-level marketing state for sckools.com: the owner-editable pricing/
 * contact config (singleton row) and the callback-request lead inbox.
 */
export declare class MarketingService {
    private readonly mail;
    private readonly logger;
    constructor(mail: MailService);
    /** Returns the singleton config, creating it with defaults on first read. */
    getConfigRow(): Promise<MarketingConfig>;
    getPublicConfig(): Promise<PublicMarketingConfig>;
    updateConfig(dto: UpdateMarketingConfigDto): Promise<MarketingConfig>;
    createLead(dto: CreateLeadDto): Promise<{
        ok: true;
    }>;
    listLeads(status?: 'NEW' | 'CONTACTED' | 'CLOSED'): Promise<MarketingLead[]>;
    setLeadStatus(id: string, status: 'NEW' | 'CONTACTED' | 'CLOSED'): Promise<MarketingLead>;
}
//# sourceMappingURL=marketing.service.d.ts.map