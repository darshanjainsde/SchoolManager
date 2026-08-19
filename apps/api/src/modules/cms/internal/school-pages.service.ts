import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, withTenant } from '@skoolos/db';
import type { UpsertSchoolPageDto } from './cms.dto';

/**
 * Admin-built pages: typed blocks (validated shape-wise on the web, stored as
 * Json, re-normalized by the renderer — the same three-layer contract as
 * navConfig). The slug is FROZEN at creation, like nav slugs: renaming the
 * page moves its label everywhere, never its address.
 */

const PAGE_CAP = 20;
/** Slugs that already mean something on a school site. */
const RESERVED_SLUGS = new Set([
  'academics', 'admissions', 'gallery', 'connect', 'contact', 'blog', 'login',
  'app', 'portal', 'overview', 'p', 'about', 'preview',
]);

export function pageSlugOf(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function normalizeBlocks(blocks: unknown[]): Prisma.InputJsonValue {
  // Deep shape validation lives on the web (normalizePageBlocks) and again in
  // the renderer; here the API just bounds the payload.
  return blocks.slice(0, 40) as Prisma.InputJsonValue;
}

@Injectable()
export class SchoolPagesService {
  list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.schoolPage.findMany({ where: { schoolId }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
    );
  }

  async create(schoolId: string, dto: UpsertSchoolPageDto) {
    const slug = pageSlugOf(dto.slug?.trim() || dto.title);
    if (!slug) throw new BadRequestException('The page needs a name that can become a web address.');
    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException(`“/${slug}” is already a page every school site has. Pick another name.`);
    }
    return withTenant(schoolId, async (tx) => {
      const count = await tx.schoolPage.count({ where: { schoolId } });
      if (count >= PAGE_CAP) {
        throw new BadRequestException(`A site can carry ${PAGE_CAP} custom pages. Remove one to add another.`);
      }
      const clash = await tx.schoolPage.findFirst({ where: { schoolId, slug } });
      if (clash) throw new BadRequestException(`A page already lives at /p/${slug}.`);
      return tx.schoolPage.create({
        data: {
          schoolId,
          slug,
          title: dto.title,
          blocks: normalizeBlocks(dto.blocks),
          published: dto.published ?? true,
          order: dto.order ?? count,
        },
      });
    });
  }

  async update(schoolId: string, id: string, dto: UpsertSchoolPageDto) {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.schoolPage.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Page not found');
      // dto.slug deliberately ignored: the address survives every rename.
      return tx.schoolPage.update({
        where: { id },
        data: {
          title: dto.title,
          blocks: normalizeBlocks(dto.blocks),
          ...(dto.published === undefined ? {} : { published: dto.published }),
          ...(dto.order === undefined ? {} : { order: dto.order }),
        },
      });
    });
  }

  async remove(schoolId: string, id: string) {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.schoolPage.findFirst({ where: { id, schoolId } });
      if (!existing) throw new NotFoundException('Page not found');
      await tx.schoolPage.delete({ where: { id } });
    });
    return { ok: true };
  }
}
