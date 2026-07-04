import { Injectable, NotFoundException } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { ModerateEventDto, OwnerCreateEventDto } from './owner.dto';

@Injectable()
export class OwnerEventsService {
  async listNetwork(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const db = getPlatformPrisma();
    return db.event.findMany({
      where: { scope: 'NETWORK', ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { school: { select: { name: true, slug: true } } },
    });
  }

  async moderate(id: string, dto: ModerateEventDto, ownerUserId: string) {
    const db = getPlatformPrisma();
    const ev = await db.event.findFirst({ where: { id, scope: 'NETWORK' } });
    if (!ev) throw new NotFoundException('Network event not found');
    const status = dto.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    return db.event.update({
      where: { id },
      data: {
        status,
        approvedByUserId: ownerUserId,
        approvedAt: dto.action === 'APPROVE' ? new Date() : null,
      },
    });
  }

  async createNetwork(dto: OwnerCreateEventDto, ownerUserId: string) {
    const db = getPlatformPrisma();
    const school = await db.school.findUnique({
      where: { id: dto.schoolId },
      select: { name: true },
    });
    if (!school) throw new NotFoundException('School not found');
    return db.event.create({
      data: {
        schoolId: dto.schoolId,
        title: dto.title,
        description: dto.description ?? null,
        startAt: new Date(dto.startAt),
        endAt: dto.endAt ? new Date(dto.endAt) : null,
        venue: dto.venue ?? null,
        scope: 'NETWORK',
        status: 'APPROVED',
        originSchoolName: school.name,
        approvedByUserId: ownerUserId,
        approvedAt: new Date(),
      },
    });
  }
}
