import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma, Prisma, type BlogPost } from '@skoolos/db';
import { isP2002 } from '../../management/internal/prisma-errors';
import type { CreatePostDto, UpdatePostDto, PatchSelectionDto, BlogSettingsDto } from './blog.dto';

/**
 * School-admin authoring + curation. BlogPost/SchoolBlogSelection have no RLS
 * policy (unlike most tenant tables — see migration 20260724165303_blog_platform),
 * because the global blog and the "select someone else's approved post"
 * library flow both need legitimate cross-tenant reads. So this service uses
 * getPlatformPrisma() directly and — unlike RLS-backed services — MUST filter
 * every query/mutation by schoolId itself; there is no database-level backstop.
 */
@Injectable()
export class BlogCmsService {
  private db() {
    return getPlatformPrisma();
  }

  list(schoolId: string): Promise<BlogPost[]> {
    return this.db().blogPost.findMany({ where: { schoolId }, orderBy: { updatedAt: 'desc' } });
  }

  async get(schoolId: string, id: string): Promise<BlogPost> {
    const post = await this.db().blogPost.findFirst({ where: { id, schoolId } });
    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  async create(schoolId: string, dto: CreatePostDto): Promise<BlogPost> {
    try {
      return await this.db().blogPost.create({
        data: {
          schoolId,
          scope: 'SCHOOL',
          slug: dto.slug,
          title: dto.title,
          description: dto.description,
          heroImageUrl: dto.heroImageUrl ?? null,
          readMinutes: dto.readMinutes ?? 4,
          sections: dto.sections as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A post with this slug already exists');
      throw e;
    }
  }

  async update(schoolId: string, id: string, dto: UpdatePostDto): Promise<BlogPost> {
    const existing = await this.get(schoolId, id);
    if (dto.slug !== undefined && dto.slug !== existing.slug && existing.status === 'PUBLISHED') {
      throw new BadRequestException('Slug cannot change after the post is published');
    }
    try {
      return await this.db().blogPost.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.slug !== undefined && { slug: dto.slug }),
          ...(dto.heroImageUrl !== undefined && { heroImageUrl: dto.heroImageUrl }),
          ...(dto.readMinutes !== undefined && { readMinutes: dto.readMinutes }),
          ...(dto.sections !== undefined && { sections: dto.sections as unknown as Prisma.InputJsonValue }),
        },
      });
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('A post with this slug already exists');
      throw e;
    }
  }

  async remove(schoolId: string, id: string) {
    await this.get(schoolId, id);
    await this.db().blogPost.delete({ where: { id } });
    return { ok: true };
  }

  /** Publish + auto-create (or leave alone) this school's own selection row. */
  async publish(schoolId: string, id: string): Promise<BlogPost> {
    const existing = await this.get(schoolId, id);
    const post = await this.db().blogPost.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: existing.publishedAt ?? new Date() },
    });
    await this.db().schoolBlogSelection.upsert({
      where: { schoolId_postId: { schoolId, postId: id } },
      update: {},
      create: { schoolId, postId: id, isHero: false, sortOrder: 0 },
    });
    return post;
  }

  async submitGlobal(schoolId: string, id: string): Promise<BlogPost> {
    const existing = await this.get(schoolId, id);
    if (existing.status !== 'PUBLISHED') {
      throw new BadRequestException('Post must be published before submitting for global syndication');
    }
    if (existing.globalStatus === 'PENDING') throw new ConflictException('Already pending approval');
    if (existing.globalStatus === 'APPROVED') throw new ConflictException('Already approved');
    return this.db().blogPost.update({
      where: { id },
      data: { globalStatus: 'PENDING', rejectReason: null },
    });
  }

  /** Approved global posts (own school's are excluded — nothing to "select" about your own), flagged with `selected`. */
  async library(schoolId: string) {
    const db = this.db();
    const [posts, mine] = await Promise.all([
      db.blogPost.findMany({
        where: { status: 'PUBLISHED', globalStatus: 'APPROVED', schoolId: { not: schoolId } },
        orderBy: { publishedAt: 'desc' },
        include: { school: { select: { name: true } } },
      }),
      db.schoolBlogSelection.findMany({ where: { schoolId }, select: { postId: true } }),
    ]);
    const selected = new Set(mine.map((m) => m.postId));
    return posts.map((p) => ({
      id: p.id,
      slug: p.globalSlug ?? p.slug,
      title: p.title,
      description: p.description,
      heroImageUrl: p.heroImageUrl,
      readMinutes: p.readMinutes,
      publishedAt: p.publishedAt,
      authorName: p.scope === 'SCHOOL' ? (p.school?.name ?? null) : null,
      selected: selected.has(p.id),
    }));
  }

  /**
   * All of this school's selection rows (own published posts get one
   * auto-created on publish; curated posts get one via addSelection), each
   * joined with the post's display fields — the school console's Layout tab
   * needs isHero/sortOrder per post, which neither list()/library() expose.
   */
  async listSelections(schoolId: string) {
    const rows = await this.db().schoolBlogSelection.findMany({
      where: { schoolId },
      orderBy: [{ isHero: 'desc' }, { sortOrder: 'asc' }],
      include: { post: { include: { school: { select: { name: true } } } } },
    });
    return rows.map((r) => ({
      postId: r.postId,
      isHero: r.isHero,
      sortOrder: r.sortOrder,
      post: {
        title: r.post.title,
        slug: r.post.slug,
        heroImageUrl: r.post.heroImageUrl,
        isOwn: r.post.schoolId === schoolId,
        authorName: r.post.scope === 'SCHOOL' && r.post.schoolId !== schoolId ? (r.post.school?.name ?? null) : null,
      },
    }));
  }

  async addSelection(schoolId: string, postId: string) {
    const db = this.db();
    const post = await db.blogPost.findFirst({ where: { id: postId, status: 'PUBLISHED', globalStatus: 'APPROVED' } });
    if (!post) throw new NotFoundException('Global post not found');
    if (post.schoolId === schoolId) throw new BadRequestException('Cannot select your own post from the library');
    try {
      return await db.schoolBlogSelection.create({ data: { schoolId, postId, isHero: false, sortOrder: 0 } });
    } catch (e) {
      if (isP2002(e)) throw new ConflictException('Already selected');
      throw e;
    }
  }

  async removeSelection(schoolId: string, postId: string) {
    const db = this.db();
    const sel = await db.schoolBlogSelection.findUnique({ where: { schoolId_postId: { schoolId, postId } } });
    if (!sel) throw new NotFoundException('Selection not found');
    await db.schoolBlogSelection.delete({ where: { id: sel.id } });
    return { ok: true };
  }

  /** `isHero: true` is rejected once the school is already at its blogHeroLimit. */
  async patchSelection(schoolId: string, postId: string, dto: PatchSelectionDto) {
    const db = this.db();
    const sel = await db.schoolBlogSelection.findUnique({ where: { schoolId_postId: { schoolId, postId } } });
    if (!sel) throw new NotFoundException('Selection not found');

    if (dto.isHero === true && !sel.isHero) {
      const profile = await db.schoolProfile.findUnique({ where: { schoolId }, select: { blogHeroLimit: true } });
      const limit = profile?.blogHeroLimit ?? 1;
      const heroCount = await db.schoolBlogSelection.count({ where: { schoolId, isHero: true } });
      if (heroCount >= limit) throw new ConflictException(`Hero limit reached (${limit})`);
    }

    return db.schoolBlogSelection.update({
      where: { id: sel.id },
      data: {
        ...(dto.isHero !== undefined && { isHero: dto.isHero }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async getSettings(schoolId: string) {
    const profile = await this.db().schoolProfile.findUnique({
      where: { schoolId },
      select: { blogLayout: true, blogHeroLimit: true },
    });
    return { blogLayout: profile?.blogLayout ?? 'HERO_GRID', blogHeroLimit: profile?.blogHeroLimit ?? 1 };
  }

  async updateSettings(schoolId: string, dto: BlogSettingsDto) {
    const data = {
      ...(dto.blogLayout !== undefined && { blogLayout: dto.blogLayout }),
      ...(dto.blogHeroLimit !== undefined && { blogHeroLimit: dto.blogHeroLimit }),
    };
    return this.db().schoolProfile.upsert({
      where: { schoolId },
      update: data,
      create: { schoolId, ...data },
    });
  }
}
