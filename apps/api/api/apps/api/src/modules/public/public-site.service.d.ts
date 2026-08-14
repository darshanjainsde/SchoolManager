import { TenantContextService } from '../tenancy';
import { FeatureResolverService } from '../features';
import { PublicEventsService } from '../community';
import type { PublicSiteData } from './public.dto';
export declare class PublicSiteService {
    private readonly tenant;
    private readonly features;
    private readonly publicEvents;
    constructor(tenant: TenantContextService, features: FeatureResolverService, publicEvents: PublicEventsService);
    getSite(): Promise<PublicSiteData>;
}
//# sourceMappingURL=public-site.service.d.ts.map