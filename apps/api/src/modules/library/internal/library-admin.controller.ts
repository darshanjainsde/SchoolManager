import { Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { LibraryOrgService } from './library-org.service';
import { LibraryEnrolmentService } from './library-enrolment.service';

/**
 * Running the library, for the people who run the school.
 *
 * SCHOOL_ADMIN and LIBRARIAN both. The admin sets the library up; the librarian
 * lives in it. Neither TEACHER nor STUDENT may reach anything here.
 */
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('LIBRARY')
@Roles('SCHOOL_ADMIN', 'LIBRARIAN')
@Controller('manage/library')
export class LibraryAdminController {
  constructor(
    private readonly orgs: LibraryOrgService,
    private readonly enrolment: LibraryEnrolmentService,
  ) {}

  private async orgId(user: SchoolJwtPayload): Promise<string> {
    const orgId = await this.orgs.orgIdForSchool(user.schoolId);
    if (!orgId) throw new ForbiddenException('This school does not have a library yet');
    return orgId;
  }

  /**
   * Enrol everyone on the roster who is not already a member.
   *
   * Safe to press repeatedly — that is also how a school handles the April
   * intake. It never touches an existing member, because their borrower number
   * is written into a physical register.
   */
  @Post('enrol')
  async enrol(@CurrentUser() user: SchoolJwtPayload) {
    return this.enrolment.enrolSchool(await this.orgId(user), user.schoolId);
  }

  /**
   * Is this school's library usable, and is it LIVE?
   *
   * `live` is what the student and teacher nav gate reads: provisioned AND at
   * least one book. A tab that opens onto an empty shelf during the weeks
   * between setup and stocking is the impression every student forms of the
   * feature.
   */
  @Get('status')
  async status(@CurrentUser() user: SchoolJwtPayload) {
    const orgId = await this.orgs.orgIdForSchool(user.schoolId);
    if (!orgId) return { provisioned: false, live: false, members: 0, copies: 0 };
    return this.orgs.statusFor(orgId);
  }
}
