import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { getPlatformPrisma } from '@skoolos/db';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';

/**
 * Read-only platform-owner endpoints listing all schools. These EXIST so
 * Phase 1 tests can prove that (a) a platform-token reader can cross tenants
 * and (b) a school user cannot reach this path under any circumstances.
 * Full owner-portal CRUD lands in Phase 2.
 */
@ApiTags('platform')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform/schools')
export class PlatformSchoolsController {
  @Get()
  async list() {
    return getPlatformPrisma().school.findMany({
      select: { id: true, name: true, slug: true, subscriptionStatus: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    const school = await getPlatformPrisma().school.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        subscriptionPlan: true,
        subscriptionStatus: true,
        timezone: true,
        createdAt: true,
        customDomains: { select: { hostname: true, status: true, isPrimary: true } },
      },
    });
    if (!school) throw new NotFoundException();
    return school;
  }
}
