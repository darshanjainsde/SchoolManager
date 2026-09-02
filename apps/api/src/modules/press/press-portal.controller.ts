import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { PressRegisterService } from './press-register.service';

/**
 * `/me/report-cards` — the family's copies of what the office issued.
 *
 * There is deliberately no student id parameter anywhere here: the row is
 * always resolved from the caller's own JWT, matching `FeePortalController`.
 * Certificates are NOT surfaced on the portal — a TC is handed over at the
 * counter, and its appearance online before that conversation would be the
 * software announcing a family's departure to the family.
 */
@Controller('me/report-cards')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('PRESS')
@Roles('STUDENT')
export class PressPortalController {
  constructor(
    private readonly register: PressRegisterService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  mine(@CurrentUser() u: SchoolJwtPayload) {
    return this.register.myReportCards(this.tenant.requireTenant().schoolId, u.sub);
  }

  @Get(':id')
  one(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.register.myReportCard(this.tenant.requireTenant().schoolId, u.sub, id);
  }
}
