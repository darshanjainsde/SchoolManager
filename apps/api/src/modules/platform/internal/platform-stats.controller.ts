import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { getPlatformPrisma } from '@skoolos/db';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';

/**
 * Dashboard cards. Stripe MRR is a placeholder until Phase 5 wires it.
 */
@ApiTags('platform-stats')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform/stats')
export class PlatformStatsController {
  @Get()
  async stats() {
    const prisma = getPlatformPrisma();
    const [schools, users, activeSchools, suspendedSchools, pendingDomains] = await Promise.all([
      prisma.school.count(),
      prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      prisma.school.count({ where: { suspendedAt: null, subscriptionStatus: 'ACTIVE' } }),
      prisma.school.count({ where: { suspendedAt: { not: null } } }),
      prisma.customDomain.count({
        where: { status: { in: ['PENDING', 'VERIFYING', 'ERROR'] } },
      }),
    ]);
    const usersByRole: Record<string, number> = {};
    for (const row of users) {
      usersByRole[row.role] = row._count._all;
    }
    return {
      totals: {
        schools,
        activeSchools,
        suspendedSchools,
        students: usersByRole.STUDENT ?? 0,
        teachers: usersByRole.TEACHER ?? 0,
        admins: usersByRole.SCHOOL_ADMIN ?? 0,
        parents: usersByRole.PARENT ?? 0,
        staff: usersByRole.STAFF ?? 0,
      },
      domains: { pendingOrError: pendingDomains },
      // MRR placeholder — Stripe wiring lands Phase 5.
      revenue: { mrr: null as null | number, currency: 'USD' },
      health: { api: 'ok', db: 'ok' },
    };
  }
}
