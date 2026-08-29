import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, withTenant } from '@skoolos/db';
import { SiteContentService } from './site-content.service';
import type { UpsertDesignDraftDto } from './cms.dto';
import { mergeSectionVariantContent, pickDesignConfig } from './design-config';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';

/**
 * Saved website looks. A draft is the DESIGN subset of the profile as one
 * JSON blob:
 *
 *  - Preview never touches the server — the studio renders the config
 *    client-side through the real PublicSite.
 *  - "Publish now" copies the config into SchoolProfile (below).
 *  - A [publishAt, revertAt] window is applied AT READ TIME by the public
 *    projection (PublicSiteService) — no scheduler, no state transition, and
 *    a festival edition therefore reverts itself even if every worker is down.
 */

const DRAFT_CAP = 30;

/** undefined = field omitted (leave untouched on update); null/'' = clear. */
function parseWhen(value: string | null | undefined, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} is not a valid date`);
  return d;
}

@Injectable()
export class DesignDraftsService {
  constructor(private readonly content: SiteContentService) {}

  list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.designDraft.findMany({ take: LIST_CEILING.ACTIVITY, where: { schoolId }, orderBy: { updatedAt: 'desc' } }),
    );
  }

  create(schoolId: string, dto: UpsertDesignDraftDto) {
    const publishAt = parseWhen(dto.publishAt, 'publishAt');
    const revertAt = parseWhen(dto.revertAt, 'revertAt');
    if (publishAt && revertAt && revertAt <= publishAt) {
      throw new BadRequestException('The revert date has to come after the publish date.');
    }
    return withTenant(schoolId, async (tx) => {
      const count = await tx.designDraft.count({ where: { schoolId } });
      if (count >= DRAFT_CAP) {
        throw new BadRequestException(`A school can keep ${DRAFT_CAP} saved looks. Delete one to save another.`);
      }
      return tx.designDraft.create({
        data: {
          schoolId,
          name: dto.name,
          config: pickDesignConfig(dto.config) as Prisma.InputJsonValue,
          publishAt,
          revertAt,
        },
      });
    });
  }

  async update(schoolId: string, id: string, dto: UpsertDesignDraftDto) {
    // undefined = the field was omitted, so leave it as stored; null clears it.
    const publishAt = parseWhen(dto.publishAt, 'publishAt');
    const revertAt = parseWhen(dto.revertAt, 'revertAt');
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.designDraft.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Draft not found');
      const effPublish = publishAt === undefined ? existing.publishAt : publishAt;
      const effRevert = revertAt === undefined ? existing.revertAt : revertAt;
      if (effPublish && effRevert && effRevert <= effPublish) {
        throw new BadRequestException('The revert date has to come after the publish date.');
      }
      return tx.designDraft.update({
        where: { id },
        data: {
          name: dto.name,
          config: pickDesignConfig(dto.config) as Prisma.InputJsonValue,
          ...(publishAt === undefined ? {} : { publishAt }),
          ...(revertAt === undefined ? {} : { revertAt }),
        },
      });
    });
  }

  async remove(schoolId: string, id: string) {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.designDraft.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Draft not found');
      await tx.designDraft.delete({ where: { id } });
    });
    return { ok: true };
  }

  /** Copy the draft's design into the live profile, immediately. Any schedule
   *  window on the draft is cleared — it has served its purpose. */
  async publish(schoolId: string, id: string) {
    const draft = await withTenant(schoolId, (tx) => tx.designDraft.findFirst({ where: { id, schoolId } }));
    if (!draft) throw new NotFoundException('Draft not found');
    const config = pickDesignConfig((draft.config ?? {}) as Record<string, unknown>);
    // A look styles the bands; the admin's own homepage sections and their
    // order (reserved keys inside sectionVariants) are content. Publishing a
    // draft — especially one saved before those existed — must not delete
    // them, so carry the live profile's values through the copy.
    if (config.sectionVariants !== undefined) {
      const live = await withTenant(schoolId, (tx) =>
        tx.schoolProfile.findUnique({ where: { schoolId }, select: { sectionVariants: true } }),
      );
      config.sectionVariants = mergeSectionVariantContent(config.sectionVariants, live?.sectionVariants);
    }
    // Routed through updateProfile so the heroStyle/heroLayout shim and the
    // Json-column handling apply exactly as they do for a direct save.
    const content = await this.content.updateProfile(schoolId, config);
    await withTenant(schoolId, (tx) =>
      tx.designDraft.update({ where: { id }, data: { publishAt: null, revertAt: null } }),
    );
    return content;
  }
}
