import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { TenantContextService } from '../tenancy';
import { EnquiryService } from './enquiry.service';
import { SetEnquiryStatusDto } from './public.dto';

@Controller('site')
// SchoolJwtGuard establishes WHICH school you belong to; it reads no role at
// all. Without RolesGuard beside it every route here was reachable with a
// STUDENT or PARENT token — and the enquiries ones hand back other families'
// names and phone numbers. Every caller lives under /app, which is already
// SCHOOL_ADMIN-only, so this locks out nobody who was legitimately using it.
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
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
