import { Injectable, NotFoundException } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { TenantContextService } from '../tenancy';
import { TimetableService } from '../management/timetable.service';

@Injectable()
export class PortalService {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly timetableSvc: TimetableService,
  ) {}

  private async myStudent(schoolId: string, userId: string) {
    return withTenant(schoolId, (tx) =>
      tx.student.findFirst({
        where: { userId },
        include: { classSection: { select: { id: true, name: true } } },
      }),
    );
  }

  async profile(userId: string) {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    // Resolve photo URL if present (mirror how public-site resolves asset ids).
    let photoUrl: string | null = null;
    if (s.photoAssetId) {
      photoUrl = await withTenant(schoolId, async (tx) => {
        const a = await tx.mediaAsset.findFirst({ where: { id: s.photoAssetId! }, select: { url: true } });
        return a?.url ?? null;
      });
    }
    return {
      firstName: s.firstName,
      lastName: s.lastName,
      admissionNo: s.admissionNo,
      rollNo: s.rollNo,
      className: s.classSection?.name ?? null,
      photoUrl,
    };
  }

  async timetable(userId: string) {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    if (!s.classSectionId) return [];
    return this.timetableSvc.listForClass(schoolId, s.classSectionId);
  }

  async announcements(userId: string) {
    const { schoolId } = this.tenant.requireTenant();
    const s = await this.myStudent(schoolId, userId);
    if (!s) throw new NotFoundException('No student record for this login');
    return withTenant(schoolId, (tx) =>
      tx.announcement.findMany({
        where: {
          schoolId,
          OR: [{ classSectionId: null }, ...(s.classSectionId ? [{ classSectionId: s.classSectionId }] : [])],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }
}
