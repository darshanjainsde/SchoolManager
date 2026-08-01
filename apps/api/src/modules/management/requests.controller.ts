import { Controller, Get, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import type { UnreadCountResult } from '@skoolos/types';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { LeaveService } from './leave.service';
import { RegisterChangeService } from './register-change.service';

/**
 * The teacher "Requests" tile badge — ONE number = the caller's own PENDING
 * leave applications + register-change requests (the two things the Requests
 * screen lists together). Both underlying counts resolve ownership from the
 * caller's Teacher record, never from a client-supplied id. Reuses the existing
 * `LeaveService`/`RegisterChangeService` rather than a new query surface.
 */
@Controller('manage/requests')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
export class RequestsController {
  constructor(
    private readonly leave: LeaveService,
    private readonly registerChanges: RegisterChangeService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get('pending-count')
  @Roles('TEACHER')
  async pendingCount(@CurrentUser() u: SchoolJwtPayload): Promise<UnreadCountResult> {
    const { schoolId } = this.tenant.requireTenant();
    const [leave, register] = await Promise.all([
      this.leave.pendingCount(schoolId, u.sub),
      this.registerChanges.pendingCount(schoolId, u.sub),
    ]);
    return { count: leave + register };
  }
}
