import { BlogMarketingService } from './blog-marketing.service';
/** Public, unauthenticated endpoints backing the sckools.com global blog. */
export declare class BlogMarketingController {
    private readonly marketing;
    constructor(marketing: BlogMarketingService);
    list(): Promise<{
        posts: import("./blog.dto").BlogCard[];
    }>;
    get(globalSlug: string): Promise<import("./blog.dto").BlogPostFull>;
}
//# sourceMappingURL=blog-marketing.controller.d.ts.map