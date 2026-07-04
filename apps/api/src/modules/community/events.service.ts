import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import { isP2002, isP2025, isP2003 } from '../management/internal/prisma-errors';
import { CreateEventDto, UpdateEventDto } from './community.dto';

@Injectable()
export class EventsService {
  constructor(private readonly tenant: TenantContextService) {}

  async list() {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.event.findMany({ where: { schoolId }, orderBy: { startAt: 'desc' } }),
    );
  }

  async create(dto: CreateEventDto) {
    const { schoolId } = this.tenant.requireTenant();
    if (dto.endAt && new Date(dto.endAt) < new Date(dto.startAt)) {
      throw new BadRequestException('endAt must be after startAt');
    }
    return withTenant(schoolId, async (tx) => {
      const school = await tx.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { name: true },
      });
      let coverUrl: string | null = null;
      if (dto.coverAssetId) {
        const asset = await tx.mediaAsset.findFirst({
          where: { schoolId, id: dto.coverAssetId },
          select: { url: true },
        });
        if (!asset) throw new BadRequestException('coverAssetId not found');
        coverUrl = asset.url;
      }
      const status = dto.scope === 'NETWORK' ? 'PENDING' : 'APPROVED';
      try {
        return await tx.event.create({
          data: {
            schoolId,
            title: dto.title,
            description: dto.description ?? null,
            coverAssetId: dto.coverAssetId ?? null,
            coverUrl,
            startAt: new Date(dto.startAt),
            endAt: dto.endAt ? new Date(dto.endAt) : null,
            venue: dto.venue ?? null,
            scope: dto.scope,
            status,
            originSchoolName: school.name,
          },
        });
      } catch (e) {
        if (isP2002(e)) throw new ConflictException('Duplicate event');
        throw e;
      }
    });
  }

  async update(id: string, dto: UpdateEventDto) {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      let coverUrl: string | undefined;
      if (dto.coverAssetId) {
        const asset = await tx.mediaAsset.findFirst({
          where: { schoolId, id: dto.coverAssetId },
          select: { url: true },
        });
        if (!asset) throw new BadRequestException('coverAssetId not found');
        coverUrl = asset.url;
      }
      try {
        return await tx.event.update({
          where: { id },
          data: {
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(dto.coverAssetId !== undefined ? { coverAssetId: dto.coverAssetId, coverUrl } : {}),
            ...(dto.startAt !== undefined ? { startAt: new Date(dto.startAt) } : {}),
            ...(dto.endAt !== undefined ? { endAt: dto.endAt ? new Date(dto.endAt) : null } : {}),
            ...(dto.venue !== undefined ? { venue: dto.venue } : {}),
          },
        });
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Event not found');
        if (isP2002(e)) throw new ConflictException('Duplicate event');
        throw e;
      }
    });
  }

  async remove(id: string) {
    const { schoolId } = this.tenant.requireTenant();
    return withTenant(schoolId, async (tx) => {
      try {
        await tx.event.delete({ where: { id } });
        return { ok: true };
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Event not found');
        if (isP2003(e)) throw new ConflictException('Event in use');
        throw e;
      }
    });
  }
}
