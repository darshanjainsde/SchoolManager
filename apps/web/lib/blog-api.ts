import type { BlogBlock } from '@skoolos/db';

/**
 * Server-side fetchers for the DB-backed blog (global + tenant). Mirrors the
 * conventions in `lib/public-api.ts`: base-URL resolution via
 * API_INTERNAL_URL / NEXT_PUBLIC_API_URL, localhost→127.0.0.1 normalisation
 * (undici resolves `localhost` to IPv6 `::1`, which the API — bound to IPv4 —
 * refuses), X-Skoolos-Host + X-Forwarded-Host for tenant-scoped calls, and
 * `null` returned on any failure so pages can 404/fallback gracefully.
 *
 * ISR: all reads are `revalidate: 300` — the blog module hits the DB directly
 * (no Redis cache like feature resolution), so a 5-minute page cache keeps DB
 * load flat regardless of traffic (see plan: "DB hit ~12×/hour/page").
 */

export interface BlogCard {
  slug: string;
  title: string;
  description: string;
  heroImageUrl: string | null;
  readMinutes: number;
  publishedAt: string | null;
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

export interface GlobalBlogResponse {
  posts: BlogCard[];
}

export interface SchoolBlogPost extends BlogCard {
  isHero: boolean;
  isOwn: boolean;
}

export interface SchoolBlogResponse {
  layout: 'HERO_GRID' | 'GRID' | 'LIST';
  heroLimit: number;
  posts: SchoolBlogPost[];
}

export interface SchoolBlogPostFull extends BlogPostFull {
  canonicalUrl: string;
}

function apiBase(): string {
  const raw = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
  return raw.replace('localhost', '127.0.0.1');
}

/** Global blog index — sckools.com/blog. */
export async function fetchGlobalBlog(): Promise<GlobalBlogResponse | null> {
  try {
    const res = await fetch(`${apiBase()}/marketing/blog`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as GlobalBlogResponse;
  } catch {
    return null;
  }
}

/** Single global post by its globalSlug. */
export async function fetchGlobalPost(globalSlug: string): Promise<BlogPostFull | null> {
  try {
    const res = await fetch(`${apiBase()}/marketing/blog/${globalSlug}`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return (await res.json()) as BlogPostFull;
  } catch {
    return null;
  }
}

/** School (tenant) blog index — <school>.sckools.com/blog. 404s upstream when BLOG feature is off.
 *  60 s (not the platform blog's 300): an admin who just hit Publish checks
 *  their own site straight away, and five minutes of "No posts yet" reads as
 *  a broken publish, not a cache. */
export async function fetchSchoolBlog(host: string): Promise<SchoolBlogResponse | null> {
  try {
    const res = await fetch(`${apiBase()}/public/blog`, {
      headers: { 'X-Forwarded-Host': host, 'X-Skoolos-Host': host },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as SchoolBlogResponse;
  } catch {
    return null;
  }
}

/** Single tenant post by its own slug (own posts) or its selected global slug. */
export async function fetchSchoolPost(host: string, slug: string): Promise<SchoolBlogPostFull | null> {
  try {
    const res = await fetch(`${apiBase()}/public/blog/${slug}`, {
      headers: { 'X-Forwarded-Host': host, 'X-Skoolos-Host': host },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as SchoolBlogPostFull;
  } catch {
    return null;
  }
}
