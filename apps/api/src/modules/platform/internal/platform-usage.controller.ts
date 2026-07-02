import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { getPlatformPrisma } from '@skoolos/db';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';

interface UsageRow {
  schoolId: string;
  slug: string;
  name: string;
  userCount: bigint;
  auditCount: bigint;
}

/**
 * Phase 1 — per-tenant usage view (stripped to school/user/audit counts).
 * ERP fields (enrollments, attendance, assignments, invoices, payments) removed
 * when those modules were deleted in Phase 1.
 */
@ApiTags('platform-usage')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform/usage')
export class PlatformUsageController {
  @Get()
  async list(): Promise<unknown> {
    const prisma = getPlatformPrisma();
    const [schools, users, domains] = await Promise.all([
      prisma.school.findMany({ select: { id: true, slug: true, name: true } }),
      prisma.user.groupBy({ by: ['schoolId'], _count: { _all: true } }),
      prisma.customDomain.groupBy({ by: ['schoolId'], _count: { _all: true } }),
    ]);

    const userCountMap = new Map(users.map((u) => [u.schoolId, u._count._all]));
    const domainCountMap = new Map(domains.map((d) => [d.schoolId, d._count._all]));

    return schools.map((s) => ({
      schoolId: s.id,
      slug: s.slug,
      name: s.name,
      userCount: userCountMap.get(s.id) ?? 0,
      domainCount: domainCountMap.get(s.id) ?? 0,
    }));
  }
}
