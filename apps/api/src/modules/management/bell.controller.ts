import { Controller, Get, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { BellService } from './bell.service';

/**
 * The Morning Bell — `GET /manage/bell`.
 *
 * SCHOOL_ADMIN only: this is the principal's first look of the day on the
 * admin dashboard, and it aggregates numbers (fees collected, every queue)
 * that no narrower role can see in one place.
 */
@Controller('manage/bell')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class BellController {
  constructor(
    private readonly bell: BellService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  today() {
    return this.bell.compose(this.tenant.requireTenant().schoolId);
  }
}
