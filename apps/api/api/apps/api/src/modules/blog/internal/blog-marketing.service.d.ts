import type { BlogCard, BlogPostFull } from './blog.dto';
/**
 * Global blog on the platform host (sckools.com/blog). Deliberately
 * cross-tenant — like DirectoryService, this is platform-level public data,
 * so it reads via getPlatformPrisma rather than the tenant `withTenant` path.
 */
export declare class BlogMarketingService {
    listGlobal(): Promise<{
        posts: BlogCard[];
    }>;
    getGlobal(globalSlug: string): Promise<BlogPostFull>;
}
//# sourceMappingURL=blog-marketing.service.d.ts.map