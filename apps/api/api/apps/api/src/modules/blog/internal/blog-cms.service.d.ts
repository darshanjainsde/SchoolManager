import { Prisma, type BlogPost } from '@skoolos/db';
import type { CreatePostDto, UpdatePostDto, PatchSelectionDto, BlogSettingsDto } from './blog.dto';
/**
 * School-admin authoring + curation. BlogPost/SchoolBlogSelection have no RLS
 * policy (unlike most tenant tables — see migration 20260724165303_blog_platform),
 * because the global blog and the "select someone else's approved post"
 * library flow both need legitimate cross-tenant reads. So this service uses
 * getPlatformPrisma() directly and — unlike RLS-backed services — MUST filter
 * every query/mutation by schoolId itself; there is no database-level backstop.
 */
export declare class BlogCmsService {
    private db;
    list(schoolId: string): Promise<BlogPost[]>;
    get(schoolId: string, id: string): Promise<BlogPost>;
    create(schoolId: string, dto: CreatePostDto): Promise<BlogPost>;
    update(schoolId: string, id: string, dto: UpdatePostDto): Promise<BlogPost>;
    remove(schoolId: string, id: string): Promise<{
        ok: boolean;
    }>;
    /**
     * Next sortOrder for a new selection row: appended to the end of the
     * school's list (max existing + 1), so new selections don't all tie at 0
     * and silently defeat the Layout tab's up/down reordering.
     */
    private nextSortOrder;
    /** Publish + auto-create (or leave alone) this school's own selection row. */
    publish(schoolId: string, id: string): Promise<BlogPost>;
    submitGlobal(schoolId: string, id: string): Promise<BlogPost>;
    /** Approved global posts (own school's are excluded — nothing to "select" about your own), flagged with `selected`. */
    library(schoolId: string): Promise<{
        id: string;
        slug: string;
        title: string;
        description: string;
        heroImageUrl: string | null;
        readMinutes: number;
        publishedAt: Date | null;
        authorName: string | null;
        selected: boolean;
    }[]>;
    /**
     * All of this school's selection rows (own published posts get one
     * auto-created on publish; curated posts get one via addSelection), each
     * joined with the post's display fields — the school console's Layout tab
     * needs isHero/sortOrder per post, which neither list()/library() expose.
     */
    listSelections(schoolId: string): Promise<{
        postId: string;
        isHero: boolean;
        sortOrder: number;
        post: {
            title: string;
            slug: string;
            heroImageUrl: string | null;
            isOwn: boolean;
            authorName: string | null;
        };
    }[]>;
    addSelection(schoolId: string, postId: string): Promise<{
        id: string;
        createdAt: Date;
        schoolId: string;
        postId: string;
        isHero: boolean;
        sortOrder: number;
    }>;
    removeSelection(schoolId: string, postId: string): Promise<{
        ok: boolean;
    }>;
    /** `isHero: true` is rejected once the school is already at its blogHeroLimit. */
    patchSelection(schoolId: string, postId: string, dto: PatchSelectionDto): Promise<{
        id: string;
        createdAt: Date;
        schoolId: string;
        postId: string;
        isHero: boolean;
        sortOrder: number;
    }>;
    getSettings(schoolId: string): Promise<{
        blogLayout: string;
        blogHeroLimit: number;
    }>;
    updateSettings(schoolId: string, dto: BlogSettingsDto): Promise<{
        email: string | null;
        id: string;
        schoolId: string;
        region: string | null;
        phone: string | null;
        logoAssetId: string | null;
        faviconAssetId: string | null;
        brandColorPrimary: string;
        brandColorSecondary: string;
        headingFont: string;
        heroStyle: string;
        animationLevel: string;
        themePreset: string | null;
        heroLayout: string;
        heroTextAlign: string;
        heroOverlayStyle: string;
        heroOverlayOpacity: number;
        heroHeight: string;
        headlineAccent: string;
        sectionShape: string;
        motionGesture: string;
        backgroundTexture: string;
        navConfig: Prisma.JsonValue | null;
        navStyle: string;
        navColor: string;
        navTextColor: string;
        navCtaLabel: string;
        navShowCta: boolean;
        navShowLogin: boolean;
        navLoginLabel: string;
        navLoginStyle: string;
        blogLayout: string;
        blogHeroLimit: number;
        addressLine1: string | null;
        addressLine2: string | null;
        city: string | null;
        postalCode: string | null;
        country: string | null;
        geoLat: number | null;
        geoLng: number | null;
        mapEmbedUrl: string | null;
    }>;
}
//# sourceMappingURL=blog-cms.service.d.ts.map