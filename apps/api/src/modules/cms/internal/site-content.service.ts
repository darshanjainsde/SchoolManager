import { Injectable } from '@nestjs/common';
import { Prisma, withTenant } from '@skoolos/db';
import type { UpdateProfileDto, UpdateHomepageDto, StatItemDto, SocialLinkDto } from './cms.dto';
import { sanitizeCustomCssMap, sanitizeHtmlBlock } from './custom-code';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';
import { assertTenantOwned } from '../../../common/tenancy/assert-tenant-owned';

/** SchoolProfile's Json columns. Prisma types Json input as InputJsonValue, so
 *  none of them can ride along in the scalar spread (see updateProfile). */
const PROFILE_JSON_KEYS = [
  'navConfig',
  'sectionVariants',
  'festiveTheme',
  'footerConfig',
  'customSectionCss',
] as const;

@Injectable()
export class SiteContentService {
  async getContent(schoolId: string) {
    return withTenant(schoolId, async (tx) => {
      const [profile, homepage, stats, socialLinks] = await Promise.all([
        tx.schoolProfile.findUnique({ where: { schoolId } }),
        tx.homepageContent.findUnique({ where: { schoolId } }),
        tx.statItem.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, orderBy: { order: 'asc' } }),
        tx.socialLink.findMany({ take: LIST_CEILING.STRUCTURE, where: { schoolId }, orderBy: { order: 'asc' } }),
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
      // Only remap when the legacy value actually changed — several layouts
      // share heroStyle=PHOTO, so an unchanged re-send (e.g. an old admin
      // bundle saving the Theme form) must not clobber a specific layout.
      const existing = await withTenant(schoolId, (tx) =>
        tx.schoolProfile.findUnique({ where: { schoolId }, select: { heroStyle: true } }),
      );
      if (existing?.heroStyle !== data.heroStyle) {
        data.heroLayout = data.heroStyle === 'PHOTO' ? 'FULL_BLEED' : data.heroStyle;
      }
    }
    // The custom-code escape hatch is sanitized ON WRITE — the renderer scopes
    // and re-sanitizes on read, and neither side trusts the stored value alone.
    if (data.customSectionCss !== undefined) {
      data.customSectionCss = sanitizeCustomCssMap(data.customSectionCss);
    }
    if (typeof data.customHtmlBlock === 'string') {
      data.customHtmlBlock = data.customHtmlBlock.trim() ? sanitizeHtmlBlock(data.customHtmlBlock) : '';
    }
    // Json columns cannot ride along in the spread the way every scalar field
    // does — Prisma types their input as InputJsonValue, not a plain object.
    const { navConfig, sectionVariants, festiveTheme, footerConfig, customSectionCss, ...scalars } = data;
    const jsonValues: Record<(typeof PROFILE_JSON_KEYS)[number], unknown> = {
      navConfig,
      sectionVariants,
      festiveTheme,
      footerConfig,
      customSectionCss,
    };
    const jsonPart: Record<string, Prisma.InputJsonValue> = {};
    for (const key of PROFILE_JSON_KEYS) {
      const value = jsonValues[key];
      if (value !== undefined) jsonPart[key] = value as Prisma.InputJsonValue;
    }
    await withTenant(schoolId, async (tx) => {
      // logoAssetId arrives from the request and is later dereferenced on the
      // PLATFORM client when the mail identity builds a letterhead
      // (mail-identity.service.ts) — outside RLS, so another school's asset
      // id would resolve and its URL would appear on this school's email.
      // The email-settings path already checks this; the CMS profile was the
      // way around it. Postgres will not do it for us: a foreign key is
      // satisfied by a row the caller cannot see.
      await assertTenantOwned([
        { field: 'logoAssetId', id: scalars.logoAssetId as string | null | undefined, model: tx.mediaAsset },
      ]);
      return tx.schoolProfile.upsert({
        where: { schoolId },
        update: { ...scalars, ...jsonPart },
        create: { schoolId, ...scalars, ...jsonPart },
      });
    });
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
