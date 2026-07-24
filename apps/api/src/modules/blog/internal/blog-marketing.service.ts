import { Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma, type BlogBlock } from '@skoolos/db';
import type { BlogCard, BlogPostFull } from './blog.dto';
import { schoolHost } from './blog-host.util';

/**
 * Global blog on the platform host (sckools.com/blog). Deliberately
 * cross-tenant — like DirectoryService, this is platform-level public data,
 * so it reads via getPlatformPrisma rather than the tenant `withTenant` path.
 */
@Injectable()
export class BlogMarketingService {
  async listGlobal(): Promise<{ posts: BlogCard[] }> {
    const db = getPlatformPrisma();
    const posts = await db.blogPost.findMany({
      where: { status: 'PUBLISHED', globalStatus: 'APPROVED' },
      orderBy: { publishedAt: 'desc' },
      include: { school: { select: { name: true } } },
    });
    return { posts: posts.map(toCard) };
  }

  async getGlobal(globalSlug: string): Promise<BlogPostFull> {
    const db = getPlatformPrisma();
    const post = await db.blogPost.findFirst({
      where: { globalSlug, status: 'PUBLISHED', globalStatus: 'APPROVED' },
      include: { school: { include: { domains: { where: { isPrimary: true }, take: 1 } } } },
    });
    if (!post) throw new NotFoundException('Post not found');

    return {
      ...toCard(post),
      sections: post.sections as unknown as BlogBlock[],
      author:
        post.scope === 'SCHOOL' && post.school
          ? { name: post.school.name, host: schoolHost(post.school) }
          : null,
    };
  }
}

function toCard(post: {
  slug: string;
  globalSlug: string | null;
  title: string;
  description: string;
  heroImageUrl: string | null;
  readMinutes: number;
  publishedAt: Date | null;
  scope: string;
  school: { name: string } | null;
}): BlogCard {
  return {
    slug: post.globalSlug ?? post.slug,
    title: post.title,
    description: post.description,
    heroImageUrl: post.heroImageUrl,
    readMinutes: post.readMinutes,
    publishedAt: post.publishedAt,
    authorName: post.scope === 'SCHOOL' ? (post.school?.name ?? undefined) : undefined,
  };
}
