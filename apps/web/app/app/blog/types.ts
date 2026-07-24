import type { BlogBlock } from '@skoolos/db';

export type { BlogBlock };

export type BlogPostStatus = 'DRAFT' | 'PUBLISHED';
export type BlogGlobalStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type BlogLayoutPreset = 'HERO_GRID' | 'GRID' | 'LIST';

/** Mirrors the Prisma `BlogPost` row shape as returned by `GET/POST/PATCH /cms/blog/posts`. */
export interface BlogPostRow {
  id: string;
  scope: 'PLATFORM' | 'SCHOOL';
  schoolId: string | null;
  slug: string;
  title: string;
  description: string;
  heroImageUrl: string | null;
  readMinutes: number;
  sections: BlogBlock[];
  status: BlogPostStatus;
  globalStatus: BlogGlobalStatus;
  globalSlug: string | null;
  rejectReason: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `GET /cms/blog/library` items. */
export interface LibraryPost {
  id: string;
  slug: string;
  title: string;
  description: string;
  heroImageUrl: string | null;
  readMinutes: number;
  publishedAt: string | null;
  authorName: string | null;
  selected: boolean;
}

/** Mirrors `GET /cms/blog/selections` items. */
export interface SelectionRow {
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
}

export interface BlogSettings {
  blogLayout: BlogLayoutPreset;
  blogHeroLimit: number;
}
