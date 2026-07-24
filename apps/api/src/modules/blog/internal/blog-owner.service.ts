import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma, type BlogBlock, type BlogPost } from '@skoolos/db';
import { isP2002 } from '../../management/internal/prisma-errors';

@Injectable()
export class BlogOwnerService {
  private db() {
    return getPlatformPrisma();
  }

  async listPending() {
    const posts = await this.db().blogPost.findMany({
      where: { globalStatus: 'PENDING' },
      orderBy: { updatedAt: 'asc' },
      include: { school: { select: { name: true, slug: true } } },
    });
    return posts.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      heroImageUrl: p.heroImageUrl,
      readMinutes: p.readMinutes,
      sections: p.sections as unknown as BlogBlock[],
      publishedAt: p.publishedAt,
      schoolName: p.school?.name ?? null,
      schoolSlug: p.school?.slug ?? null,
    }));
  }

  /**
   * Approves for global syndication. globalSlug defaults to the post's own
   * slug; on collision with an existing globalSlug (from a different post,
   * e.g. the platform's own posts or another school's approved post) it's
   * suffixed with `-<schoolSlug>` — a second collision is treated as
   * unresolvable rather than silently looping (platform + one school sharing
   * both a slug AND that suffixed form would be a very unlucky coincidence
   * worth surfacing rather than papering over).
   */
  async approve(id: string): Promise<BlogPost> {
    const db = this.db();
    const post = await db.blogPost.findUnique({ where: { id }, include: { school: { select: { slug: true } } } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.globalStatus !== 'PENDING') throw new ConflictException('Post is not pending approval');

    let globalSlug = post.slug;
    const clash = await db.blogPost.findFirst({ where: { globalSlug, NOT: { id: post.id } } });
    if (clash) {
      globalSlug = `${post.slug}-${post.school?.slug ?? 'school'}`;
      const stillClashing = await db.blogPost.findFirst({ where: { globalSlug, NOT: { id: post.id } } });
      if (stillClashing) throw new ConflictException('Could not resolve a unique global slug for this post');
    }

    try {
      return await db.blogPost.update({
        where: { id },
        data: { globalStatus: 'APPROVED', globalSlug, rejectReason: null },
      });
    } catch (e) {
      // The pre-check above is a TOCTOU race against a concurrent approval
      // landing the same globalSlug — the unique constraint is the real
      // backstop, so surface it as a retryable conflict rather than a 500.
      if (isP2002(e)) throw new ConflictException('global slug conflict, retry approval');
      throw e;
    }
  }

  async reject(id: string, reason: string): Promise<BlogPost> {
    const db = this.db();
    const post = await db.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Post not found');
    if (post.globalStatus !== 'PENDING') throw new ConflictException('Post is not pending approval');
    return db.blogPost.update({
      where: { id },
      data: { globalStatus: 'REJECTED', rejectReason: reason },
    });
  }
}
