import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AnyJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { EnquiryService } from './enquiry.service';
import { AddEnquiryNoteDto, SetEnquiryStatusDto } from './public.dto';

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

  /** Who wrote a note or moved a stage — denormalised onto the history line. */
  private actor(user?: AnyJwtPayload) {
    return { userId: user && 'sub' in user ? user.sub : undefined, name: null };
  }

  @Get('enquiries')
  list() {
    return this.enquiry.list(this.sid());
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
