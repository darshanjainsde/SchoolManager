import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AnyJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { EnquiryService } from './enquiry.service';
import { AdmissionsDeskGuard } from './internal/admissions-desk.guard';
import { AddEnquiryNoteDto, SetEnquiryStatusDto } from './public.dto';

@Controller('site')
// SchoolJwtGuard establishes WHICH school you belong to and reads no role.
// RolesGuard admits SCHOOL_ADMIN and STAFF; AdmissionsDeskGuard then narrows
// STAFF to an active admissions officer. A STUDENT, PARENT or TEACHER token is
// refused by RolesGuard, a driver by the desk guard — these routes hand back
// other families' names and phone numbers.
@UseGuards(SchoolJwtGuard, RolesGuard, AdmissionsDeskGuard)
@Roles('SCHOOL_ADMIN', 'STAFF')
export class EnquiryAdminController {
  constructor(
    private readonly enquiry: EnquiryService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  /** Who is acting. The service signs the history line with their name (Actor.name left out on purpose). */
  private actor(user?: AnyJwtPayload) {
    return { userId: user && 'sub' in user ? user.sub : undefined };
  }

  @Get('enquiries')
  list() {
    return this.enquiry.list(this.sid());
  }

  /**
   * Who a lead can be given to. Declared BEFORE `enquiries/:id`: Express
   * matches in declaration order, and `:id`'s ParseUUIDPipe would answer the
   * word "owners" with a 400.
   */
  @Get('enquiries/owners')
  owners() {
    return this.enquiry.owners(this.sid());
  }

  @Get('enquiries/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.enquiry.detail(this.sid(), id);
  }

  @Patch('enquiries/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetEnquiryStatusDto,
    @CurrentUser() user?: AnyJwtPayload,
  ) {
    return this.enquiry.update(this.sid(), id, dto, this.actor(user));
  }

  @Post('enquiries/:id/notes')
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddEnquiryNoteDto,
    @CurrentUser() user?: AnyJwtPayload,
  ) {
    return this.enquiry.addNote(this.sid(), id, dto.body, this.actor(user));
  }
}
