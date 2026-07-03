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
    await withTenant(schoolId, (tx) =>
      tx.schoolProfile.upsert({ where: { schoolId }, update: dto, create: { schoolId, ...dto } }),
    );
    return this.getContent(schoolId);
  }

  async updateHomepage(schoolId: string, dto: UpdateHomepageDto) {
    await withTenant(schoolId, (tx) =>
      tx.homepageContent.upsert({ where: { schoolId }, update: dto, create: { schoolId, ...dto } }),
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
