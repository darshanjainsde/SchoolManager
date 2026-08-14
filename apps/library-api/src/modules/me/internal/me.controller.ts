import { Controller, Get, Inject, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { MeService } from './me.service';
import { MyHistoryQueryDto } from './dto';

/**
 * A borrower's own account.
 *
 * Every route resolves the member from the caller's OWN login inside the
 * service — there is no member id anywhere in a path, a query or a body, so
 * there is nothing to tamper with. Staff roles are allowed through because a
 * librarian who also borrows books has an account of their own; a staff login
 * with no member row gets a clean 404 rather than someone else's data.
 *
 * `BranchScopeGuard` is deliberately absent from this chain: a borrower's own
 * issues are theirs regardless of which branch lent them, and scoping by the
 * staff branch list would blank the screen for a member whose token carries no
 * branches at all.
 */
@Controller('me')
@UseGuards(LibJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('CIRCULATION')
export class MeController {
  constructor(
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
    @Inject(MeService) private readonly me: MeService,
  ) {}

  /** The books they are holding, and when each is due back. */
  @Get('issues')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER')
  myIssues(@CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.me.myIssues(tx, orgId, user.sub, now));
  }

  /** What they owe — only charges that already exist and are already payable. */
  @Get('dues')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER')
  myDues(@CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.me.myDues(tx, user.sub));
  }

  /** Everything they have borrowed. */
  @Get('history')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER')
  myHistory(@Query() query: MyHistoryQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.me.myHistory(tx, user.sub, query.limit ?? 50));
  }

  /** "Is it on the shelf?" — counts only, never a list of copies. */
  @Get('availability/:titleId')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER')
  availability(@Param('titleId', new ParseUUIDPipe()) titleId: string) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.me.availability(tx, orgId, titleId));
  }
}
