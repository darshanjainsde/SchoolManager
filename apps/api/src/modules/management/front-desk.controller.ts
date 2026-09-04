import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { ConsoleSearchService } from './console-search.service';
import { PulseService } from './pulse.service';

/**
 * The Front Desk's two reads: the command bar's index and the pulse tiles.
 * SCHOOL_ADMIN only — both aggregate across every register (money included),
 * and the dashboard they serve is the admin's.
 */
@Controller('manage')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class FrontDeskController {
  constructor(
    private readonly search: ConsoleSearchService,
    private readonly pulseSvc: PulseService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get('search')
  find(@Query('q') q = '') {
    return this.search.search(this.tenant.requireTenant().schoolId, q);
  }

  @Get('pulse')
  pulse() {
    return this.pulseSvc.pulse(this.tenant.requireTenant().schoolId);
  }
}
