import { PublicSiteService } from './public-site.service';
export declare class PublicSiteController {
    private readonly publicSite;
    constructor(publicSite: PublicSiteService);
    /**
     * Unauthenticated, host-resolved public site data.
     * Generous throttle: 300 requests per 60 s per IP.
     */
    site(): Promise<import("./public.dto").PublicSiteData>;
}
//# sourceMappingURL=public-site.controller.d.ts.map