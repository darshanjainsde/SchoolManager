import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { UpdateProfileDto, UpdateHomepageDto, StatItemDto, SocialLinkDto } from './cms.dto';

@Injectable()
export class SiteContentService {
  async getContent(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [profile, homepage, stats, socialLinks] = await Promise.all([
        tx.schoolProfile.findUnique({ where: { schoolId } }),
        tx.homepageContent.findUnique({ where: { schoolId } }),
        tx.statItem.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.socialLink.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
      ]);
      return { profile, homepage, stats, socialLinks };
    });
  }

  async updateProfile(schoolId: string, dto: UpdateProfileDto) {
    // Keep the legacy 3-value heroStyle and the new heroLayout coherent no
    // matter which one a client writes (old admin bundles still send heroStyle).
    const data: UpdateProfileDto = { ...dto };
    if (data.heroLayout && !data.heroStyle) {
      data.heroStyle =
        data.heroLayout === 'ILLUSTRATION' ? 'ILLUSTRATION'
        : data.heroLayout === 'MINIMAL' ? 'MINIMAL'
        : 'PHOTO';
    } else if (data.heroStyle && !data.heroLayout) {
      data.heroLayout =
        data.heroStyle === 'PHOTO' ? 'FULL_BLEED' : data.heroStyle;
    }
    await withTenant(schoolId, (tx) =>
      tx.schoolProfile.upsert({ where: { schoolId }, update: data, create: { schoolId, ...data } }),
    );
    return this.getContent(schoolId);
  }

  async updateHomepage(schoolId: string, dto: UpdateHomepageDto) {
    // heroAssetId (legacy single image) and heroImageAssetIds (ordered slots)
    // describe the same thing; keep slot 1 and the legacy field in sync.
    const data: UpdateHomepageDto & { heroAssetId?: string | null } = { ...dto };
    if (data.heroImageAssetIds) {
      // Empty slots clear the legacy field (null), they don't preserve it.
      data.heroAssetId = data.heroImageAssetIds[0] ?? null;
    } else if (data.heroAssetId) {
      const existing = await withTenant(schoolId, (tx) =>
        tx.homepageContent.findUnique({ where: { schoolId }, select: { heroImageAssetIds: true } }),
      );
      data.heroImageAssetIds = [data.heroAssetId, ...(existing?.heroImageAssetIds.slice(1) ?? [])];
    }
    await withTenant(schoolId, (tx) =>
      tx.homepageContent.upsert({ where: { schoolId }, update: data, create: { schoolId, ...data } }),
    );
    return this.getContent(schoolId);
  }

  async setStats(schoolId: string, items: StatItemDto[]) {
    await withTenant(schoolId, async (tx) => {
      await tx.statItem.deleteMany({ where: { schoolId } });
      if (items.length)
        await tx.statItem.createMany({
          data: items.map((i) => ({ ...i, schoolId })),
        });
    });
    return this.getContent(schoolId);
  }

  async setSocial(schoolId: string, links: SocialLinkDto[]) {
    await withTenant(schoolId, async (tx) => {
      await tx.socialLink.deleteMany({ where: { schoolId } });
      if (links.length)
        await tx.socialLink.createMany({
          data: links.map((l) => ({
            platform: l.platform as any,
            url: l.url,
            order: l.order,
            schoolId,
          })),
        });
    });
    return this.getContent(schoolId);
  }
}
