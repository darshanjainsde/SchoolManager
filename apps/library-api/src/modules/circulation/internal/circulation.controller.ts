import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { IdempotencyInterceptor } from '../../../common/idempotency/idempotency.interceptor';
import { CreateHoldDto, IssueLoanDto, ListHoldsQueryDto, RenewLoanDto, ReturnLoanDto } from './dto';
import { HoldsService } from './holds.service';
import { LoansService } from './loans.service';

/**
 * Guard order mirrors `CatalogController`: JWT identity, then the plan
 * capability gate, then role. `@RequireFeature('CIRCULATION')` is
 * class-level (both routes need it). `ORG_OWNER`/`LIBRARIAN`/`ASSISTANT`
 * work the desk; `MEMBER` is denied — asserted in test/endpoints.ts, which
 * the authz matrix's "covers every registered route" check enforces is kept
 * in sync with what's actually mounted here.
 *
 * `IdempotencyInterceptor` is opt-in per route (see its own class doc): a
 * barcode scanner double-fire converges on ONE stored response for a
 * *retried* request, but it is NOT what makes a genuinely concurrent
 * double-scan produce only one Loan — that's `loan_one_active_per_copy`
 * (Task 4), asserted directly in `loans.service.ts`'s `issue` doc and in
 * this module's e2e suite.
 */
@Controller('circulation')
@UseGuards(LibJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('CIRCULATION')
export class CirculationController {
  constructor(
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
    @Inject(LoansService) private readonly loans: LoansService,
    @Inject(HoldsService) private readonly holds: HoldsService,
  ) {}

  @Post('issue')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  issue(@Body() dto: IssueLoanDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    // The wall clock is read exactly once per request, here, and threaded
    // through as an explicit parameter — never `new Date()` inside
    // loans.service.ts or policy.ts (see policy.ts's own header comment).
    const now = new Date();
    return withOrg(orgId, (tx) => this.loans.issue(tx, orgId, dto, user.sub, now));
  }

  @Post('return')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  returnLoan(@Body() dto: ReturnLoanDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.loans.returnLoan(tx, orgId, dto, user.sub, now));
  }

  @Post('renew')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  renew(@Body() dto: RenewLoanDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.holds.renew(tx, orgId, dto, user.sub, now));
  }

  @Post('holds')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  createHold(@Body() dto: CreateHoldDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.holds.createHold(tx, orgId, dto, user.sub, now));
  }

  @Delete('holds/:id')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  cancelHold(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.holds.cancelHold(tx, orgId, id, user.sub));
  }

  @Get('holds')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  listHolds(@Query() query: ListHoldsQueryDto) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.holds.listHolds(tx, orgId, query, now));
  }
}
