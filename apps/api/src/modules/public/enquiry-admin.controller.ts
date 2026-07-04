import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { TenantContextService } from '../tenancy';
import { EnquiryService } from './enquiry.service';
import { SetEnquiryStatusDto } from './public.dto';

@Controller('site')
@UseGuards(SchoolJwtGuard)
export class EnquiryAdminController {
  constructor(
    private readonly enquiry: EnquiryService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Get('enquiries')
  list() {
    return this.enquiry.list(this.sid());
  }

  @Patch('enquiries/:id')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetEnquiryStatusDto,
  ) {
    return this.enquiry.setStatus(this.sid(), id, dto.status);
  }
}
