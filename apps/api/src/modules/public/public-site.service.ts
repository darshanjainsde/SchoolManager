import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant, type FeatureKey } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import { FeatureResolverService } from '../features';
import { PublicEventsService } from '../community';
import { mergeSectionVariantContent, pickDesignConfig } from '../cms';
import type { PublicSiteData } from './public.dto';

@Injectable()
export class PublicSiteService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly features: FeatureResolverService,
    private readonly publicEvents: PublicEventsService,
  ) {}

  async getSite(): Promise<PublicSiteData> {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'tenant') throw new NotFoundException('Site not found');
    const schoolId = ctx.schoolId;
    const feat = await this.features.getFeatures(schoolId);

    return withTenant(schoolId, async (tx) => {
      const school = await tx.school.findUnique({ where: { id: schoolId } });
      if (!school) throw new NotFoundException('Site not found');
      // Only a published (LIVE) school serves a public site. SETUP schools are
      // still resolvable so their admin can log in and build the site, but the
      // public site 404s until the owner publishes it (PATCH /owner/schools/:id/status).
      if (school.status !== 'LIVE') throw new NotFoundException('Site not found');

      const now = new Date();
      const [rawProfile, homepage, stats, socials, galleryAssets, staff, courses, admissionSteps, admissionsSettings, sitePages, scheduledLook] =
        await Promise.all([
          tx.schoolProfile.findUnique({ where: { schoolId } }),
          tx.homepageContent.findUnique({ where: { schoolId } }),
          tx.statItem.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
          tx.socialLink.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
          tx.mediaAsset.findMany({ where: { schoolId, kind: 'GALLERY' }, orderBy: { order: 'asc' } }),
          tx.featuredStaff.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
          tx.course.findMany({
            where: { schoolId },
            orderBy: { order: 'asc' },
            include: { fee: true, hallOfFame: { orderBy: { rank: 'asc' } } },
          }),
          tx.admissionStep.findMany({ where: { schoolId }, orderBy: { order: 'asc' } }),
          tx.admissionsSettings.findUnique({ where: { schoolId } }),
          tx.schoolPage.findMany({
            where: { schoolId, published: true },
            orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
            select: { slug: true, title: true, blocks: true, showInNav: true },
          }),
          // A scheduled look whose window contains NOW. Applied as a read-time
          // overlay — it reverts itself when the window closes, with no
          // scheduler and no state transition (see DesignDraft in the schema).
          tx.designDraft.findFirst({
            where: {
              schoolId,
              publishAt: { lte: now },
              OR: [{ revertAt: null }, { revertAt: { gt: now } }],
            },
            orderBy: { publishAt: 'desc' },
          }),
        ]);

      // A scheduled look overlays STYLING only: if it carries sectionVariants,
      // the admin's own homepage sections and band order (reserved keys) must
      // still come from the live profile, or the window would hide them.
      const scheduledConfig = scheduledLook
        ? pickDesignConfig((scheduledLook.config ?? {}) as Record<string, unknown>)
        : null;
      if (scheduledConfig && scheduledConfig.sectionVariants !== undefined) {
        scheduledConfig.sectionVariants = mergeSectionVariantContent(
          scheduledConfig.sectionVariants,
          rawProfile?.sectionVariants,
        );
      }
      const profile = rawProfile && scheduledConfig ? { ...rawProfile, ...scheduledConfig } : rawProfile;

      // Resolve all asset ids referenced by profile/homepage/staff/courses in one query.
      const ids = [
        profile?.logoAssetId,
        profile?.faviconAssetId,
        homepage?.heroAssetId,
        ...(homepage?.heroImageAssetIds ?? []),
        homepage?.principalPhotoAssetId,
        homepage?.aboutImageAssetId,
        ...staff.map((s) => s.photoAssetId),
        ...courses.map((c) => c.imageAssetId),
        ...courses.flatMap((c) => c.hallOfFame.map((h) => h.photoAssetId)),
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
      const showFees = admissionsSettings?.showFeesPublicly ?? true;

      const events = has('EVENTS') ? await this.publicEvents.forHost(tx, schoolId) : [];

      return {
        school: { name: school.name, slug: school.slug, tier: school.tier, features: [...feat], timezone: school.timezone },
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
              headingFont: profile.headingFont,
              heroStyle: profile.heroStyle,
              animationLevel: profile.animationLevel,
              heroLayout: profile.heroLayout,
              heroTextAlign: profile.heroTextAlign,
              heroOverlayStyle: profile.heroOverlayStyle,
              heroOverlayOpacity: profile.heroOverlayOpacity,
              heroHeight: profile.heroHeight,
              headlineAccent: profile.headlineAccent,
              sectionShape: profile.sectionShape,
              motionGesture: profile.motionGesture,
              backgroundTexture: profile.backgroundTexture,
              navConfig: profile.navConfig,
              navStyle: profile.navStyle,
              navColor: profile.navColor,
              navTextColor: profile.navTextColor,
              navCtaLabel: profile.navCtaLabel,
              navShowCta: profile.navShowCta,
              navShowLogin: profile.navShowLogin,
              navLoginLabel: profile.navLoginLabel,
              navLoginStyle: profile.navLoginStyle,
              scrollFeel: profile.scrollFeel,
              navDropdownAnim: profile.navDropdownAnim,
              heroMedia: profile.heroMedia,
              heroVideoUrl: profile.heroVideoUrl,
              sectionVariants: profile.sectionVariants,
              festiveTheme: profile.festiveTheme,
              footerConfig: profile.footerConfig,
              customSectionCss: profile.customSectionCss,
              customHtmlBlock: profile.customHtmlBlock,
            }
          : null,
        homepage: homepage
          ? {
              headline: homepage.headline,
              subheadline: homepage.subheadline,
              heroUrl:
                homepage.heroImageAssetIds.map(urlOf).find(Boolean) ??
                urlOf(homepage.heroAssetId),
              heroImages: homepage.heroImageAssetIds
                .map(urlOf)
                .filter((u): u is string => !!u),
              aboutText: has('ABOUT_CONTACT') ? homepage.aboutText : null,
              principalName: has('ABOUT_CONTACT') ? homepage.principalName : null,
              principalMessage: has('ABOUT_CONTACT') ? homepage.principalMessage : null,
              principalPhotoUrl: has('ABOUT_CONTACT') ? urlOf(homepage.principalPhotoAssetId) : null,
              aboutImageUrl: has('ABOUT_CONTACT') ? urlOf(homepage.aboutImageAssetId) : null,
              showAdmissions: homepage.showAdmissions,
              showGallery: homepage.showGallery,
              showEvents: homepage.showEvents,
              showContact: homepage.showContact,
            }
          : null,
        stats: stats.map((s) => ({ label: s.label, value: s.value })),
        socialLinks: has('SOCIAL') ? socials.map((s) => ({ platform: s.platform, url: s.url })) : [],
        gallery: has('GALLERY') ? galleryAssets.map((g) => ({ url: g.url, caption: g.caption })) : [],
        staff: staff.map((s) => ({ name: s.name, role: s.role, photoUrl: urlOf(s.photoAssetId) })),
        courses: courses.map((c) => ({
          id: c.id,
          name: c.name,
          tagline: c.tagline,
          description: c.description,
          highlights: c.highlights,
          ageRange: c.ageRange,
          imageUrl: urlOf(c.imageAssetId),
          featured: c.featured,
          fee:
            showFees && c.fee
              ? { admissionFee: c.fee.admissionFee, annualFee: c.fee.annualFee, includes: c.fee.includes }
              : null,
          hallOfFame: c.hallOfFame.map((h) => ({
            rank: h.rank,
            name: h.name,
            achievement: h.achievement,
            year: h.year,
            photoUrl: urlOf(h.photoAssetId),
          })),
        })),
        admissions: {
          steps: admissionSteps.map((s) => ({ title: s.title, description: s.description })),
          showFees,
          feeNote: showFees ? (admissionsSettings?.feeNote ?? null) : null,
        },
        pages: sitePages.map((p) => ({ slug: p.slug, title: p.title, blocks: p.blocks, showInNav: p.showInNav })),
        events,
      };
    });
  }
}
