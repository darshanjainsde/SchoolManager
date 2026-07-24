import { Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma, type BlogBlock } from '@skoolos/db';
import { TenantContextService, type ResolvedTenant } from '../../tenancy';
import { FeatureResolverService } from '../../features';
import type { BlogCard, BlogPostFull } from './blog.dto';
import { schoolHost, platformBlogUrl, tenantBlogUrl } from './blog-host.util';

type PostWithSchool = {
  id: string;
  schoolId: string | null;
  scope: string;
  slug: string;
  globalSlug: string | null;
  status: string;
  globalStatus: string;
  title: string;
  description: string;
  heroImageUrl: string | null;
  readMinutes: number;
  sections: unknown;
  publishedAt: Date | null;
  school: { name: string; slug: string; domains: { hostname: string }[] } | null;
};

/**
 * School (tenant) blog — `<school>.sckools.com/blog`. 404s whenever the
 * tenant doesn't have the BLOG feature, matching the public-site.service.ts
 * pattern of a hard NotFoundException rather than the RequireFeatureGuard's
 * 403 (this endpoint is meant to look like the page simply doesn't exist).
 */
@Injectable()
export class BlogPublicService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly features: FeatureResolverService,
  ) {}

  private async requireBlogTenant(): Promise<ResolvedTenant> {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Not found');
    const feat = await this.features.getFeatures(ctx.schoolId);
    if (!feat.has('BLOG')) throw new NotFoundException('Not found');
    return ctx;
  }

  async list(): Promise<{ layout: string; heroLimit: number; posts: (BlogCard & { isHero: boolean; isOwn: boolean })[] }> {
    const ctx = await this.requireBlogTenant();
    const db = getPlatformPrisma();

    const [profile, selections] = await Promise.all([
      db.schoolProfile.findUnique({ where: { schoolId: ctx.schoolId }, select: { blogLayout: true, blogHeroLimit: true } }),
      db.schoolBlogSelection.findMany({
        where: { schoolId: ctx.schoolId, post: { status: 'PUBLISHED' } },
        include: { post: true },
      }),
    ]);

    const heroLimit = profile?.blogHeroLimit ?? 1;
    const heroRows = selections.filter((s) => s.isHero).sort((a, b) => a.sortOrder - b.sortOrder);
    const cappedHeroes = heroRows.slice(0, heroLimit);
    const cappedHeroIds = new Set(cappedHeroes.map((h) => h.postId));
    const rest = selections
      .filter((s) => !cappedHeroIds.has(s.postId))
      .sort((a, b) => (b.post.publishedAt?.getTime() ?? 0) - (a.post.publishedAt?.getTime() ?? 0));

    const ordered = [...cappedHeroes, ...rest];
    const posts = ordered.map((s) => {
      const isOwn = s.post.schoolId === ctx.schoolId;
      return {
        slug: isOwn ? s.post.slug : (s.post.globalSlug ?? s.post.slug),
        title: s.post.title,
        description: s.post.description,
        heroImageUrl: s.post.heroImageUrl,
        readMinutes: s.post.readMinutes,
        publishedAt: s.post.publishedAt,
        isHero: cappedHeroIds.has(s.postId),
        isOwn,
      };
    });

    return { layout: profile?.blogLayout ?? 'HERO_GRID', heroLimit, posts };
  }

  async getBySlug(slug: string): Promise<BlogPostFull & { canonicalUrl: string }> {
    const ctx = await this.requireBlogTenant();
    const db = getPlatformPrisma();

    let post: PostWithSchool | null = await db.blogPost.findUnique({
      where: { schoolId_slug: { schoolId: ctx.schoolId, slug } },
      include: { school: { include: { domains: { where: { isPrimary: true }, take: 1 } } } },
    });
    let isOwn = true;

    if (!post) {
      isOwn = false;
      const sel = await db.schoolBlogSelection.findFirst({
        where: { schoolId: ctx.schoolId, post: { globalSlug: slug, status: 'PUBLISHED', globalStatus: 'APPROVED' } },
        include: { post: { include: { school: { include: { domains: { where: { isPrimary: true }, take: 1 } } } } } },
      });
      post = sel?.post ?? null;
    }

    if (!post || post.status !== 'PUBLISHED') throw new NotFoundException('Post not found');

    const canonicalUrl =
      !isOwn
        ? platformBlogUrl(post.globalSlug!)
        : post.globalStatus === 'APPROVED'
          ? platformBlogUrl(post.globalSlug!)
          : tenantBlogUrl(ctx.hostname, post.slug);

    return {
      slug: isOwn ? post.slug : (post.globalSlug ?? post.slug),
      title: post.title,
      description: post.description,
      heroImageUrl: post.heroImageUrl,
      readMinutes: post.readMinutes,
      publishedAt: post.publishedAt,
      sections: post.sections as unknown as BlogBlock[],
      author:
        !isOwn && post.scope === 'SCHOOL' && post.school
          ? { name: post.school.name, host: schoolHost(post.school) }
          : null,
      canonicalUrl,
    };
  }
}
