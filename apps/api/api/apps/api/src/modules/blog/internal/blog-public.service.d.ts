import { TenantContextService } from '../../tenancy';
import { FeatureResolverService } from '../../features';
import type { BlogCard, BlogPostFull } from './blog.dto';
/**
 * School (tenant) blog — `<school>.sckools.com/blog`. 404s whenever the
 * tenant doesn't have the BLOG feature, matching the public-site.service.ts
 * pattern of a hard NotFoundException rather than the RequireFeatureGuard's
 * 403 (this endpoint is meant to look like the page simply doesn't exist).
 */
export declare class BlogPublicService {
    private readonly tenant;
    private readonly features;
    constructor(tenant: TenantContextService, features: FeatureResolverService);
    private requireBlogTenant;
    list(): Promise<{
        layout: string;
        heroLimit: number;
        posts: (BlogCard & {
            isHero: boolean;
            isOwn: boolean;
        })[];
    }>;
    getBySlug(slug: string): Promise<BlogPostFull & {
        canonicalUrl: string;
    }>;
}
//# sourceMappingURL=blog-public.service.d.ts.map