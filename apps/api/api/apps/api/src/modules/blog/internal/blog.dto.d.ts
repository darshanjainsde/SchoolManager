import type { BlogBlock } from '@skoolos/db';
export declare class CreatePostDto {
    title: string;
    description: string;
    slug: string;
    heroImageUrl?: string;
    readMinutes?: number;
    sections: BlogBlock[];
}
export declare class UpdatePostDto {
    title?: string;
    description?: string;
    slug?: string;
    heroImageUrl?: string;
    readMinutes?: number;
    sections?: BlogBlock[];
}
export declare class AddSelectionDto {
    postId: string;
}
export declare class PatchSelectionDto {
    isHero?: boolean;
    sortOrder?: number;
}
export declare class BlogSettingsDto {
    blogLayout?: 'HERO_GRID' | 'GRID' | 'LIST';
    blogHeroLimit?: number;
}
export declare class RejectPostDto {
    reason: string;
}
export interface BlogCard {
    slug: string;
    title: string;
    description: string;
    heroImageUrl: string | null;
    readMinutes: number;
    publishedAt: Date | null;
    authorName?: string | null;
}
export interface BlogAuthor {
    name: string;
    host: string;
}
export interface BlogPostFull extends BlogCard {
    sections: BlogBlock[];
    author: BlogAuthor | null;
}
//# sourceMappingURL=blog.dto.d.ts.map