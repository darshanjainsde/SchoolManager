import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { LeaveService } from './leave.service';
import { AssignSubstitutionDto, CreateLeaveDto } from './management.dto';

@Controller('manage/leave')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Post()
  @Roles('TEACHER')
  apply(@Body() dto: CreateLeaveDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.leave.apply(this.sid(), u.sub, dto);
  }

  @Get('mine')
  @Roles('TEACHER')
  mine(@CurrentUser() u: SchoolJwtPayload) {
    return this.leave.mine(this.sid(), u.sub);
  }

  @Get('coverage')
  @Roles('SCHOOL_ADMIN')
  coverage(@Query('from') from: string, @Query('to') to: string) {
    return this.leave.coverage(this.sid(), from, to);
  }

  @Get()
  @Roles('SCHOOL_ADMIN')
  list(@Query('status') status?: string) {
    return this.leave.list(this.sid(), status);
  }

  @Post(':id/approve')
  @Roles('SCHOOL_ADMIN')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.leave.approve(this.sid(), id, u.sub);
  }

  @Post(':id/reject')
  @Roles('SCHOOL_ADMIN')
  reject(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.leave.reject(this.sid(), id, u.sub);
  }

  /**
   * Open to both roles — `LeaveService.cancel` enforces that a TEACHER
   * caller may only cancel their OWN application; a SCHOOL_ADMIN may cancel
   * any.
   */
  @Post(':id/cancel')
  @Roles('TEACHER', 'SCHOOL_ADMIN')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.leave.cancel(this.sid(), id, u.sub, u.role);
  }
}

/**
 * Kept in this file (rather than a new `substitution.controller.ts`) since it
 * shares `LeaveService` and its route prefix — `manage/substitution` — is the
 * counterpart resource created by `LeaveService.approve`.
 */
@Controller('manage/substitution')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class SubstitutionController {
  constructor(
    private readonly leave: LeaveService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Post(':id/assign')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignSubstitutionDto) {
    return this.leave.assign(this.sid(), id, dto);
  }

  @Post(':id/clear')
  clear(@Param('id', ParseUUIDPipe) id: string) {
    return this.leave.clear(this.sid(), id);
  }
}
