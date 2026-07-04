import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { isP2002, isP2025 } from './internal/prisma-errors';
import type { CreateAnnouncementDto, UpdateAnnouncementDto } from './management.dto';

@Injectable()
export class AnnouncementsService {
  async list(schoolId: string) {
    return withTenant(schoolId, (tx) =>
      tx.announcement.findMany({
        where: { schoolId },
        orderBy: { createdAt: 'desc' },
        include: { classSection: { select: { name: true } } },
      }),
    );
  }

  async create(schoolId: string, createdByUserId: string, dto: CreateAnnouncementDto) {
    return withTenant(schoolId, async (tx) => {
      if (dto.classSectionId) {
        const cs = await tx.classSection.findFirst({ where: { id: dto.classSectionId } });
        if (!cs) throw new BadRequestException('classSectionId not found');
      }
      try {
        return await tx.announcement.create({
          data: {
            schoolId,
            title: dto.title,
            body: dto.body,
            classSectionId: dto.classSectionId ?? null,
            createdByUserId,
          },
        });
      } catch (e) {
        if (isP2002(e)) throw new ConflictException('Duplicate announcement');
        throw e;
      }
    });
  }

  async update(schoolId: string, id: string, dto: UpdateAnnouncementDto) {
    return withTenant(schoolId, async (tx) => {
      if (dto.classSectionId) {
        const cs = await tx.classSection.findFirst({ where: { id: dto.classSectionId } });
        if (!cs) throw new BadRequestException('classSectionId not found');
      }
      try {
        return await tx.announcement.update({
          where: { id },
          data: {
            ...(dto.title !== undefined ? { title: dto.title } : {}),
            ...(dto.body !== undefined ? { body: dto.body } : {}),
            ...(dto.classSectionId !== undefined ? { classSectionId: dto.classSectionId } : {}),
          },
        });
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Announcement not found');
        throw e;
      }
    });
  }

  async remove(schoolId: string, id: string) {
    return withTenant(schoolId, async (tx) => {
      try {
        await tx.announcement.delete({ where: { id } });
        return { ok: true };
      } catch (e) {
        if (isP2025(e)) throw new NotFoundException('Announcement not found');
        throw e;
      }
    });
  }
}
