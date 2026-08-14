import { Body, Controller, ForbiddenException, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { LibraryOrgService } from './library-org.service';
import { LibraryDeskService } from './library-desk.service';
import {
  AccessionNumberDto,
  DeskDayQueryDto,
  IssueAtDeskDto,
  SearchMembersQueryDto,
} from './library-desk.dto';

/**
 * The librarian's counter.
 *
 * SCHOOL_ADMIN and LIBRARIAN, the same pair `LibraryAdminController` uses: the
 * admin sets the library up and can stand in when the librarian is away; the
 * librarian lives here. A TEACHER or STUDENT token gets 403 — `/me/library` is
 * their surface, and its shapes are deliberately redacted in ways these are
 * not.
 *
 * NOT gated on `libraryLive`. That flag ("are there books in it") hides the
 * student and teacher menu items, and applying it here would lock the
 * librarian out of the only screen from which she can add the first book.
 *
 * Idempotency: none, deliberately, and it must stay that way. `apps/api` has
 * no idempotency interceptor and these are all reads. When the writes land, a
 * double-fired issue is refused by `issue_one_active_per_copy` and a
 * double-fired return finds no active issue — the database is the guarantee,
 * not a request-id cache, and nobody should later add one believing otherwise.
 */
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('LIBRARY')
@Roles('SCHOOL_ADMIN', 'LIBRARIAN')
@Controller('manage/library')
export class LibraryDeskController {
  constructor(
    private readonly orgs: LibraryOrgService,
    private readonly desk: LibraryDeskService,
  ) {}

  /**
   * Same resolution as `LibraryMeController`: a school with the feature on but
   * nothing provisioned is told so, rather than being handed a 401 for a
   * library that does not exist.
   */
  private async orgId(user: SchoolJwtPayload): Promise<string> {
    const orgId = await this.orgs.orgIdForSchool(user.schoolId);
    if (!orgId) throw new ForbiddenException('This school does not have a library yet');
    return orgId;
  }

  /**
   * Take a book back. First route on the controller because it is the first
   * thing she does — forty at once, at the start of a period.
   */
  @Post('return')
  async returnBook(@CurrentUser() user: SchoolJwtPayload, @Body() dto: AccessionNumberDto) {
    return this.desk.returnBook(await this.orgId(user), dto.accessionNumber, user.sub);
  }

  /** Give a book out to a child who has already been chosen. */
  @Post('issue')
  async issue(@CurrentUser() user: SchoolJwtPayload, @Body() dto: IssueAtDeskDto) {
    return this.desk.issueBook(await this.orgId(user), dto.accessionNumber, dto.memberId, user.sub);
  }

  /** Keep it a little longer, if the policy allows. */
  @Post('renew')
  async renew(@CurrentUser() user: SchoolJwtPayload, @Body() dto: AccessionNumberDto) {
    return this.desk.renewBook(await this.orgId(user), dto.accessionNumber, user.sub);
  }

  /** Find the child at the counter — by name, class or borrower number. */
  @Get('members')
  async members(@CurrentUser() user: SchoolJwtPayload, @Query() query: SearchMembersQueryDto) {
    return this.desk.searchMembers(await this.orgId(user), query.q, query.limit);
  }

  /**
   * What is this number, and who has it?
   *
   * Returns `null` for a number that is not in the register — a different
   * answer from "on the shelf", and the counter must be able to say so.
   */
  @Get('copies/:accessionNumber')
  async copy(
    @CurrentUser() user: SchoolJwtPayload,
    @Param('accessionNumber') accessionNumber: string,
  ) {
    return this.desk.lookupCopy(await this.orgId(user), accessionNumber);
  }

  /** What has not come back, longest late first. Derived at read time. */
  @Get('not-returned')
  async notReturned(@CurrentUser() user: SchoolJwtPayload) {
    return this.desk.notReturned(await this.orgId(user));
  }

  /** Everything that crossed the counter today, in the org's own timezone. */
  @Get('day')
  async day(@CurrentUser() user: SchoolJwtPayload, @Query() query: DeskDayQueryDto) {
    return this.desk.today(await this.orgId(user), query.date);
  }
}
