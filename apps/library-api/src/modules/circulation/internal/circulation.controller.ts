import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { BranchScopeGuard } from '../../../common/guards/branch-scope.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { IdempotencyInterceptor } from '../../../common/idempotency/idempotency.interceptor';
import { ConfirmLostDto, CreateReservationDto, DayReportQueryDto, IssueBookDto, ListFinesQueryDto, ListReservationsQueryDto, RejectLostDto, RenewBookDto, ReportLostDto, ReturnBookDto, SearchMembersQueryDto, SelfReportLostDto, WaiveFineDto } from './dto';
import { FinesService } from './fines.service';
import { ReservationsService } from './reservations.service';
import { IssuesService } from './issues.service';
import { MembersService } from './members.service';
import { LostService, LOST_TX_OPTIONS } from './lost.service';

/**
 * Guard order mirrors `CatalogController`: JWT identity, then the plan
 * capability gate, then role, then branch. `@RequireFeature('CIRCULATION')`
 * is class-level (every route needs it). `ORG_OWNER`/`LIBRARIAN`/`ASSISTANT`
 * work the desk; `MEMBER` is denied — asserted in test/endpoints.ts, which
 * the authz matrix's "covers every registered route" check enforces is kept
 * in sync with what's actually mounted here.
 *
 * `BranchScopeGuard` only enforces branch scope for a `branchId` the request
 * carries directly — none of the routes below do (accessionNumbers and member/title
 * ids, never a branchId), so this guard is effectively a no-op here today,
 * kept for the same reason `CatalogController` keeps it in its chain:
 * consistency, and so a FUTURE route that does add a request-level branchId
 * is covered automatically. The actual enforcement for every route below
 * happens in the SERVICE, against the LOADED row's own branch
 * (`assertBranchInScope` — see `issues.service.ts`/`reservations.service.ts`/
 * `fines.service.ts`), the same pattern `CopiesService` established for
 * `PATCH /catalog/copies/:id` — because the branch these actions concern is
 * a property of an existing Copy/Issue/Reservation row, not of the request.
 *
 * `IdempotencyInterceptor` is opt-in per route (see its own class doc): a
 * accessionNumber scanner double-fire converges on ONE stored response for a
 * *retried* request, but it is NOT what makes a genuinely concurrent
 * double-scan produce only one Issue — that's `issue_one_active_per_copy`
 * (Task 4), asserted directly in `issues.service.ts`'s `issue` doc and in
 * this module's e2e suite.
 */
@Controller('circulation')
@UseGuards(LibJwtGuard, RequireFeatureGuard, RolesGuard, BranchScopeGuard)
@RequireFeature('CIRCULATION')
export class CirculationController {
  constructor(
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
    @Inject(FinesService) private readonly fines: FinesService,
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(LostService) private readonly lost: LostService,
  ) {}

  @Post('issue')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  issue(@Body() dto: IssueBookDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    // The wall clock is read exactly once per request, here, and threaded
    // through as an explicit parameter — never `new Date()` inside
    // issues.service.ts or policy.ts (see policy.ts's own header comment).
    const now = new Date();
    return withOrg(orgId, (tx) => this.issues.issue(tx, orgId, dto, user.sub, now, user.branches));
  }

  @Post('return')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  returnBook(@Body() dto: ReturnBookDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.issues.returnBook(tx, orgId, dto, user.sub, now, user.branches));
  }

  /**
   * Report a book lost, from the counter.
   *
   * ASSISTANT is included deliberately: reporting a loss is a DESK action, and
   * the thing it does first is stop the child's late charge growing. Gating it
   * behind a role the person at the counter may not hold would mean the charge
   * keeps running while they wait for someone senior — the exact incentive this
   * flow exists to protect. Forgiving the money afterwards is the restricted
   * action, not recording the loss.
   */
  @Post('lost')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  reportLost(@Body() dto: ReportLostDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) => this.lost.reportLost(tx, orgId, dto, user.sub, now, user.branches),
      // `withOrg(orgId, fn, client, options)` — the transaction options are the
      // FOURTH argument, behind the client. Passing `undefined` keeps the
      // default tenant client while still widening the timeout.
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  /**
   * A child reports their own book lost, from the app. MEMBER-only in spirit,
   * but staff roles are allowed through so a librarian testing the app path
   * gets a clean 404 rather than a confusing 403 — the service resolves the
   * member from the caller's OWN login and refuses anything not in their hands,
   * so an account with no member row simply has nothing it can report.
   */
  @Post('lost/self-report')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT', 'MEMBER')
  @UseInterceptors(IdempotencyInterceptor)
  selfReportLost(@Body() dto: SelfReportLostDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) => this.lost.selfReportLost(tx, orgId, dto.accessionNumber, user.sub, now),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  /** Confirming is where the money becomes real, so it is staff-only. */
  @Post('lost/:id/confirm')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  @UseInterceptors(IdempotencyInterceptor)
  confirmLost(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmLostDto,
    @CurrentUser() user: LibJwtPayload,
  ) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) => this.lost.confirmLost(tx, orgId, id, dto.replacementPrice, user.sub, now, user.branches),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  /** The book turned up before anyone was charged. Restores the world exactly. */
  @Post('lost/:id/reject')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  @UseInterceptors(IdempotencyInterceptor)
  rejectLost(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RejectLostDto,
    @CurrentUser() user: LibJwtPayload,
  ) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) => this.lost.rejectLost(tx, orgId, id, dto.reason, user.sub, now, user.branches),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  @Post('renew')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  renew(@Body() dto: RenewBookDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.reservations.renew(tx, orgId, dto, user.sub, now, user.branches));
  }

  @Post('reservations')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  createReservation(@Body() dto: CreateReservationDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.reservations.createReservation(tx, orgId, dto, user.sub, now));
  }

  @Delete('reservations/:id')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  cancelReservation(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.reservations.cancelReservation(tx, orgId, id, user.sub, user.branches));
  }

  /**
   * Ranked member lookup for the desk — the only way to turn "Ravi Menon" or
   * "RAF-00042" into the member id every write on this controller needs.
   * Read-only and deliberately narrow (see `MEMBER_CARD_SELECT` for what it
   * withholds and why).
   *
   * It lives here rather than in a members module because a full members
   * module — enrolment, membership lifecycle, self-serve — is a later phase,
   * and a half-built one standing in its way is worse than none. The desk
   * needs to find people; this finds people.
   *
   * Same roles as the rest of the desk: `MEMBER` is denied, so a borrower
   * cannot enumerate the school roll.
   */
  @Get('members')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  searchMembers(@Query() query: SearchMembersQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.members.search(tx, orgId, query, user.branches));
  }

  @Get('reservations')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  listReservations(@Query() query: ListReservationsQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.reservations.listReservations(tx, orgId, query, now, user.branches));
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
