import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { AdmissionsService } from './admissions.service';
import { SetAdmissionStepsDto, UpdateAdmissionsSettingsDto } from './cms.dto';

@Controller('site/admissions')
@UseGuards(SchoolJwtGuard)
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
