import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AnyJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { ApiError } from '../../common/errors/api-error';
import { EnquiryService } from './enquiry.service';
import { AdmissionsDeskGuard } from './internal/admissions-desk.guard';
import { AddEnquiryNoteDto, CreateDeskEnquiryDto, SetEnquiryStatusDto } from './public.dto';

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
    return {
      userId: user && 'sub' in user ? user.sub : undefined,
      // create() decides ownership by it: an admissions officer (STAFF, past AdmissionsDeskGuard) owns what they type, a school admin does not.
      role: user?.role,
    };
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

  /** A walk-in or a phone enquiry: owned by an officer who types it, unowned when an admin does. The website form stays on /public/enquiry. */
  @Post('enquiries')
  @HttpCode(201)
  create(@Body() dto: CreateDeskEnquiryDto, @CurrentUser() user?: AnyJwtPayload) {
    return this.enquiry.create(this.sid(), dto, this.actor(user));
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

  /** A typed note, or a call / WhatsApp / visit with its outcome. */
  @Post('enquiries/:id/notes')
  addNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddEnquiryNoteDto,
    @CurrentUser() user?: AnyJwtPayload,
  ) {
    const kind = dto.kind ?? 'NOTE';
    if (kind === 'NOTE') {
      // A note has no outcome. Dropping one silently would let an officer believe
      // a lead was marked lost when nothing was written.
      if (dto.outcome !== undefined || dto.lostReason !== undefined) {
        throw new ApiError('VALIDATION', 'An outcome belongs to a call, a WhatsApp or a visit — not to a note.', 400, 'outcome');
      }
      return this.enquiry.addNote(this.sid(), id, dto.body ?? '', this.actor(user));
    }
    return this.enquiry.logContact(
      this.sid(), id, kind,
      { outcome: dto.outcome, lostReason: dto.lostReason, body: dto.body },
      this.actor(user),
    );
  }
}
