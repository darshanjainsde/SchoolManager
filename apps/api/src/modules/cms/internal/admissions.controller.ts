import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { AdmissionsService } from './admissions.service';
import { SetAdmissionStepsDto, UpdateAdmissionsSettingsDto } from './cms.dto';

@Controller('site/admissions')
// SchoolJwtGuard establishes WHICH school you belong to; it reads no role at
// all. Without RolesGuard beside it every route here was reachable with a
// STUDENT or PARENT token — and the enquiries ones hand back other families'
// names and phone numbers. Every caller lives under /app, which is already
// SCHOOL_ADMIN-only, so this locks out nobody who was legitimately using it.
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
export class AdmissionsController {
  constructor(
    private readonly admissions: AdmissionsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  get() {
    return this.admissions.get(this.sid());
  }

  @Put('steps')
  setSteps(@Body() dto: SetAdmissionStepsDto) {
    return this.admissions.setSteps(this.sid(), dto.steps);
  }

  @Put('settings')
  updateSettings(@Body() dto: UpdateAdmissionsSettingsDto) {
    return this.admissions.updateSettings(this.sid(), dto);
  }
}
