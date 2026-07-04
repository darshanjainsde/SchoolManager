import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type FeatureKey } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import { FeatureResolverService } from '../features';
import type { PublicSiteData } from './public.dto';

@Injectable()
export class PublicSiteService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly features: FeatureResolverService,
  ) {}

  async getSite(): Promise<PublicSiteData> {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Site not found');
    const schoolId = ctx.schoolId;
    const feat = await this.features.getFeatures(schoolId);

    return withTenant(schoolId, async (tx) => {
      const school = await tx.school.findUnique({ where: { id: schoolId } });
      if (!school) throw new NotFoundException('Site not found');
      if (school.status === 'SUSPENDED') throw new NotFoundException('Site not found');

      const [profile, homepage, stats, socials, galleryAssets, staff, grades] = await Promise.all([
        tx.schoolProfile.findUnique({ where: { schoolId } }),
        tx.homepageContent.findUnique({ where: { schoolId } }),
        tx.statItem.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.socialLink.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.mediaAsset.findMany({ where: { schoolId, kind: 'GALLERY' }, orderBy: { order: 'asc' } }),
        tx.featuredStaff.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.grade.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
      ]);

      // Resolve all asset ids referenced by profile/homepage/staff in one query.
      const ids = [
        profile?.logoAssetId,
        profile?.faviconAssetId,
        homepage?.heroAssetId,
        homepage?.principalPhotoAssetId,
        ...staff.map((s) => s.photoAssetId),
      ].filter(Boolean) as string[];

      const assets =
        ids.length
          ? await tx.mediaAsset.findMany({
              where: { schoolId, id: { in: ids } },
              select: { id: true, url: true },
            })
          : [];

      const urlOf = (id?: string | null) =>
        id ? (assets.find((a) => a.id === id)?.url ?? null) : null;

      const has = (k: FeatureKey) => feat.has(k);

      return {
        school: { name: school.name, slug: school.slug, tier: school.tier, features: [...feat] },
        profile: profile
          ? {
              logoUrl: urlOf(profile.logoAssetId),
              faviconUrl: urlOf(profile.faviconAssetId),
              brandColorPrimary: profile.brandColorPrimary,
              brandColorSecondary: profile.brandColorSecondary,
              phone: has('ABOUT_CONTACT') ? profile.phone : null,
              email: has('ABOUT_CONTACT') ? profile.email : null,
              addressLine1: has('ABOUT_CONTACT') ? profile.addressLine1 : null,
              addressLine2: has('ABOUT_CONTACT') ? profile.addressLine2 : null,
              city: has('ABOUT_CONTACT') ? profile.city : null,
              region: has('ABOUT_CONTACT') ? profile.region : null,
              postalCode: has('ABOUT_CONTACT') ? profile.postalCode : null,
              country: has('ABOUT_CONTACT') ? profile.country : null,
              mapEmbedUrl: has('ABOUT_CONTACT') ? profile.mapEmbedUrl : null,
            }
          : null,
        homepage: homepage
          ? {
              headline: homepage.headline,
              subheadline: homepage.subheadline,
              heroUrl: urlOf(homepage.heroAssetId),
              aboutText: has('ABOUT_CONTACT') ? homepage.aboutText : null,
              principalName: has('ABOUT_CONTACT') ? homepage.principalName : null,
              principalMessage: has('ABOUT_CONTACT') ? homepage.principalMessage : null,
              principalPhotoUrl: has('ABOUT_CONTACT') ? urlOf(homepage.principalPhotoAssetId) : null,
            }
          : null,
        stats: stats.map((s) => ({ label: s.label, value: s.value })),
        socialLinks: has('SOCIAL') ? socials.map((s) => ({ platform: s.platform, url: s.url })) : [],
        gallery: has('GALLERY') ? galleryAssets.map((g) => ({ url: g.url, caption: g.caption })) : [],
        staff: staff.map((s) => ({ name: s.name, role: s.role, photoUrl: urlOf(s.photoAssetId) })),
        menu: grades.map((g) => ({ label: g.name, gradeId: g.id })),
      };
    });
  }
}
