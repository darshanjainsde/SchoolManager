import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { RegisterChangeService } from './register-change.service';
import { CreateRegisterChangeDto } from './management.dto';

@Controller('manage/register-changes')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
export class RegisterChangeController {
  constructor(
    private readonly svc: RegisterChangeService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  // `@Get('mine')` declared ABOVE the parameterless `@Get()` below so Nest
  // matches the static path first — otherwise `@Get()` would shadow it.
  @Get('mine')
  @Roles('TEACHER')
  mine(@CurrentUser() u: SchoolJwtPayload) {
    return this.svc.mine(this.sid(), u.sub);
  }

  @Post()
  @Roles('TEACHER')
  request(@Body() dto: CreateRegisterChangeDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.request(this.sid(), u.sub, dto);
  }

  @Get()
  @Roles('SCHOOL_ADMIN')
  pending() {
    return this.svc.pending(this.sid());
  }

  @Post(':id/approve')
  @Roles('SCHOOL_ADMIN')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.review(this.sid(), u.sub, id, true);
  }

  @Post(':id/reject')
  @Roles('SCHOOL_ADMIN')
  reject(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.review(this.sid(), u.sub, id, false);
  }
}
