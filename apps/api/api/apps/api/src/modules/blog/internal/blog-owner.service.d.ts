import { type BlogBlock, type BlogPost } from '@skoolos/db';
export declare class BlogOwnerService {
    private db;
    listPending(): Promise<{
        id: string;
        slug: string;
        title: string;
        description: string;
        heroImageUrl: string | null;
        readMinutes: number;
        sections: BlogBlock[];
        publishedAt: Date | null;
        updatedAt: Date;
        schoolName: string | null;
        schoolSlug: string | null;
    }[]>;
    /**
     * Approves for global syndication. globalSlug defaults to the post's own
     * slug; on collision with an existing globalSlug (from a different post,
     * e.g. the platform's own posts or another school's approved post) it's
     * suffixed with `-<schoolSlug>` — a second collision is treated as
     * unresolvable rather than silently looping (platform + one school sharing
     * both a slug AND that suffixed form would be a very unlucky coincidence
     * worth surfacing rather than papering over).
     */
    approve(id: string): Promise<BlogPost>;
    reject(id: string, reason: string): Promise<BlogPost>;
}
//# sourceMappingURL=blog-owner.service.d.ts.map