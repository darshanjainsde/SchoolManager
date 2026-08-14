import { BlogPublicService } from './blog-public.service';
/** Public, unauthenticated, host-resolved tenant blog reads. */
export declare class BlogPublicController {
    private readonly blog;
    constructor(blog: BlogPublicService);
    list(): Promise<{
        layout: string;
        heroLimit: number;
        posts: (import("./blog.dto").BlogCard & {
            isHero: boolean;
            isOwn: boolean;
        })[];
    }>;
    get(slug: string): Promise<import("./blog.dto").BlogPostFull & {
        canonicalUrl: string;
    }>;
}
//# sourceMappingURL=blog-public.controller.d.ts.map