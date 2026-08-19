import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, withTenant } from '@skoolos/db';
import { SiteContentService } from './site-content.service';
import type { UpsertDesignDraftDto } from './cms.dto';
import { pickDesignConfig } from './design-config';

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

function parseWhen(value: string | null | undefined, field: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} is not a valid date`);
  return d;
}

@Injectable()
export class DesignDraftsService {
  constructor(private readonly content: SiteContentService) {}

  list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.designDraft.findMany({ where: { schoolId }, orderBy: { updatedAt: 'desc' } }),
    );
  }

  create(schoolId: string, dto: UpsertDesignDraftDto) {
    const publishAt = parseWhen(dto.publishAt, 'publishAt');
    const revertAt = parseWhen(dto.revertAt, 'revertAt');
    if (publishAt && revertAt && revertAt <= publishAt) {
      throw new BadRequestException('The revert date has to come after the publish date.');
    }
    return withTenant(schoolId, (tx) =>
      tx.designDraft.create({
        data: {
          schoolId,
          name: dto.name,
          config: pickDesignConfig(dto.config) as Prisma.InputJsonValue,
          publishAt,
          revertAt,
        },
      }),
    );
  }

  async update(schoolId: string, id: string, dto: UpsertDesignDraftDto) {
    const publishAt = parseWhen(dto.publishAt, 'publishAt');
    const revertAt = parseWhen(dto.revertAt, 'revertAt');
    if (publishAt && revertAt && revertAt <= publishAt) {
      throw new BadRequestException('The revert date has to come after the publish date.');
    }
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.designDraft.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Draft not found');
      return tx.designDraft.update({
        where: { id },
        data: {
          name: dto.name,
          config: pickDesignConfig(dto.config) as Prisma.InputJsonValue,
          publishAt,
          revertAt,
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
    // Routed through updateProfile so the heroStyle/heroLayout shim and the
    // Json-column handling apply exactly as they do for a direct save.
    const content = await this.content.updateProfile(schoolId, config);
    await withTenant(schoolId, (tx) =>
      tx.designDraft.update({ where: { id }, data: { publishAt: null, revertAt: null } }),
    );
    return content;
  }
}
