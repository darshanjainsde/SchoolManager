import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { BranchScopeGuard } from '../../../common/guards/branch-scope.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { IdempotencyInterceptor } from '../../../common/idempotency/idempotency.interceptor';
import { CreateHoldDto, DayReportQueryDto, IssueLoanDto, ListFinesQueryDto, ListHoldsQueryDto, RenewLoanDto, ReturnLoanDto, WaiveFineDto } from './dto';
import { FinesService } from './fines.service';
import { HoldsService } from './holds.service';
import { LoansService } from './loans.service';

/**
 * Guard order mirrors `CatalogController`: JWT identity, then the plan
 * capability gate, then role, then branch. `@RequireFeature('CIRCULATION')`
 * is class-level (every route needs it). `ORG_OWNER`/`LIBRARIAN`/`ASSISTANT`
 * work the desk; `MEMBER` is denied — asserted in test/endpoints.ts, which
 * the authz matrix's "covers every registered route" check enforces is kept
 * in sync with what's actually mounted here.
 *
 * `BranchScopeGuard` only enforces branch scope for a `branchId` the request
 * carries directly — none of the routes below do (barcodes and member/title
 * ids, never a branchId), so this guard is effectively a no-op here today,
 * kept for the same reason `CatalogController` keeps it in its chain:
 * consistency, and so a FUTURE route that does add a request-level branchId
 * is covered automatically. The actual enforcement for every route below
 * happens in the SERVICE, against the LOADED row's own branch
 * (`assertBranchInScope` — see `loans.service.ts`/`holds.service.ts`/
 * `fines.service.ts`), the same pattern `CopiesService` established for
 * `PATCH /catalog/copies/:id` — because the branch these actions concern is
 * a property of an existing Copy/Loan/Hold row, not of the request.
 *
 * `IdempotencyInterceptor` is opt-in per route (see its own class doc): a
 * barcode scanner double-fire converges on ONE stored response for a
 * *retried* request, but it is NOT what makes a genuinely concurrent
 * double-scan produce only one Loan — that's `loan_one_active_per_copy`
 * (Task 4), asserted directly in `loans.service.ts`'s `issue` doc and in
 * this module's e2e suite.
 */
@Controller('circulation')
@UseGuards(LibJwtGuard, RequireFeatureGuard, RolesGuard, BranchScopeGuard)
@RequireFeature('CIRCULATION')
export class CirculationController {
  constructor(
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
    @Inject(LoansService) private readonly loans: LoansService,
    @Inject(HoldsService) private readonly holds: HoldsService,
    @Inject(FinesService) private readonly fines: FinesService,
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
    return withOrg(orgId, (tx) => this.loans.issue(tx, orgId, dto, user.sub, now, user.branches));
  }

  @Post('return')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  returnLoan(@Body() dto: ReturnLoanDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.loans.returnLoan(tx, orgId, dto, user.sub, now, user.branches));
  }

  @Post('renew')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  renew(@Body() dto: RenewLoanDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.holds.renew(tx, orgId, dto, user.sub, now, user.branches));
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
    return withOrg(orgId, (tx) => this.holds.cancelHold(tx, orgId, id, user.sub, user.branches));
  }

  @Get('holds')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  listHolds(@Query() query: ListHoldsQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.holds.listHolds(tx, orgId, query, now, user.branches));
  }

  @Get('fines')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  listFines(@Query() query: ListFinesQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.fines.listFines(tx, orgId, query, user.branches));
  }

  /** Waiver is WRITERS-only (`ORG_OWNER`/`LIBRARIAN`) — `ASSISTANT` is deliberately denied here, asserted in the authz matrix (`test/endpoints.ts`). */
  @Post('fines/:id/waive')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  @UseInterceptors(IdempotencyInterceptor)
  waiveFine(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: WaiveFineDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.fines.waive(tx, orgId, id, dto, user.sub, now, user.branches));
  }

  @Get('overdue')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  listOverdue(@CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.fines.listOverdue(tx, orgId, now, user.branches));
  }

  @Get('day-report')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  dayReport(@Query() query: DayReportQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.fines.dayReport(tx, orgId, query, user.branches));
  }
}
