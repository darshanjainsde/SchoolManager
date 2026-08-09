import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { LeavePolicyService } from './leave-policy.service';
import {
  ApplyLeaveDefaultsDto,
  CloseLeaveYearDto,
  CreateLeaveTypeDefDto,
  SetLeaveAllocationDto,
  UpdateLeaveTypeDefDto,
} from './management.dto';

/**
 * Leave policy — the admin's levers (types, quotas, the allotment grid,
 * year close) plus the one teacher-facing read: their own balances.
 * Sits beside `manage/leave` (the applications) rather than inside it.
 */
@Controller('manage/leave-policy')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
export class LeavePolicyController {
  constructor(
    private readonly policy: LeavePolicyService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get('types')
  @Roles('SCHOOL_ADMIN')
  types() {
    return this.policy.types(this.sid());
  }

  @Post('types')
  @Roles('SCHOOL_ADMIN')
  createType(@Body() dto: CreateLeaveTypeDefDto) {
    return this.policy.createType(this.sid(), dto);
  }

  @Patch('types/:id')
  @Roles('SCHOOL_ADMIN')
  updateType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeaveTypeDefDto) {
    return this.policy.updateType(this.sid(), id, dto);
  }

  @Get('allocations')
  @Roles('SCHOOL_ADMIN')
  grid(@Query('academicYearId') academicYearId?: string) {
    return this.policy.grid(this.sid(), academicYearId || undefined);
  }

  @Post('allocations/apply-defaults')
  @Roles('SCHOOL_ADMIN')
  applyDefaults(@Body() dto: ApplyLeaveDefaultsDto) {
    return this.policy.applyDefaults(this.sid(), dto.academicYearId);
  }

  @Put('allocations')
  @Roles('SCHOOL_ADMIN')
  setAllocation(@Body() dto: SetLeaveAllocationDto) {
    return this.policy.setAllocation(this.sid(), dto);
  }

  @Post('close-year')
  @Roles('SCHOOL_ADMIN')
  closeYear(@Body() dto: CloseLeaveYearDto) {
    return this.policy.closeYear(this.sid(), dto.fromAcademicYearId, dto.toAcademicYearId);
  }

  /** Per-pending-application {requestedDays, remaining} for approve warnings. */
  @Get('pending-context')
  @Roles('SCHOOL_ADMIN')
  pendingContext() {
    return this.policy.pendingApprovalContext(this.sid());
  }

  /** The calling TEACHER's own balances — powers the chips on Requests. */
  @Get('my-balance')
  @Roles('TEACHER')
  myBalance(@CurrentUser() u: SchoolJwtPayload) {
    return this.policy.balanceForUser(this.sid(), u.sub);
  }
}
