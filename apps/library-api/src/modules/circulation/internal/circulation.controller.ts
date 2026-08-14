import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { BranchScopeGuard } from '../../../common/guards/branch-scope.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { IdempotencyInterceptor } from '../../../common/idempotency/idempotency.interceptor';
import { ConfirmLostDto, ListLostQueryDto, PayFineDto, PayLostDto, ReplaceInKindDto, ReportMissingDto, TurnedUpDto, WriteOffLostDto, CreateReservationDto, DayReportQueryDto, IssueBookDto, CollectionsQueryDto, ListDuesQueryDto, ListFinesQueryDto, WaiverLogQueryDto, ListReservationsQueryDto, RejectLostDto, RenewBookDto, ReportLostDto, ReturnBookDto, SearchMembersQueryDto, SelfReportLostDto, WaiveFineDto } from './dto';
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

  /**
   * The family paid. ASSISTANT can record it — taking money at the desk is desk
   * work; forgiving it is not (see write-off and waive, both WRITERS-only).
   */
  @Post('lost/:id/pay')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  payLost(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PayLostDto,
    @CurrentUser() user: LibJwtPayload,
  ) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) => this.lost.payLost(tx, orgId, id, dto.method, dto.note, user.sub, now, user.branches),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  /** Forgiving money. WRITERS only, and the approver is recorded in the body. */
  @Post('lost/:id/write-off')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  @UseInterceptors(IdempotencyInterceptor)
  writeOffLost(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: WriteOffLostDto,
    @CurrentUser() user: LibJwtPayload,
  ) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) =>
        this.lost.writeOffLost(tx, orgId, id, dto.approvedByNote, dto.reason, user.sub, now, user.branches),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  /** The family brought a replacement copy. Clearing a charge in kind is
   *  forgiving money, so WRITERS only. */
  @Post('lost/:id/replace')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  @UseInterceptors(IdempotencyInterceptor)
  replaceInKind(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReplaceInKindDto,
    @CurrentUser() user: LibJwtPayload,
  ) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) =>
        this.lost.replaceInKind(tx, orgId, id, dto.accessionNumber, dto.condition, user.sub, now, user.branches),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  /**
   * The original turned up.
   *
   * WRITERS, not the desk roles. The earlier comment argued that the frozen late
   * charge stands either way so this is "not a way to give money back" — but the
   * late charge is the ₹15; what this clears is the ₹299 replacement, with the
   * MECHANICAL code that also keeps it out of the collections "let off" tile. An
   * ASSISTANT could therefore erase the largest charge in the service and leave
   * no trace on the screen an owner reads. Forgiving money is WRITERS, without
   * exception.
   */
  @Post('lost/:id/found')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  @UseInterceptors(IdempotencyInterceptor)
  foundLost(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) => this.lost.foundLost(tx, orgId, id, user.sub, now, user.branches),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  /** Missing from the shelf, nobody had it. Deliberately a different route from
   *  /circulation/lost so a stock-take loss can never be pinned on a child. */
  @Post('lost/missing')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  reportMissing(@Body() dto: ReportMissingDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) => this.lost.reportMissing(tx, orgId, dto.accessionNumber, user.sub, now, user.branches),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  /**
   * The original turned up AFTER the family paid. Not a reversal — the money
   * has changed hands — so it is a choice between owing a refund and the family
   * keeping the book. WRITERS: it decides whether the school owes money.
   */
  @Post('lost/:id/turned-up')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  @UseInterceptors(IdempotencyInterceptor)
  turnedUp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TurnedUpDto,
    @CurrentUser() user: LibJwtPayload,
  ) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) => this.lost.turnedUpAfterSettlement(tx, orgId, id, dto.outcome, user.sub, now, user.branches),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  /** The money was handed back at the desk. Records that it happened. */
  @Post('lost/:id/refunded')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  @UseInterceptors(IdempotencyInterceptor)
  markRefunded(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(
      orgId,
      (tx) => this.lost.markRefunded(tx, orgId, id, user.sub, now, user.branches),
      undefined,
      LOST_TX_OPTIONS,
    );
  }

  /**
   * The lost-books queue. Staff-only, and the ONLY way any settlement route's
   * report id can be discovered — without it a child's self-report is
   * unreachable forever.
   */
  @Get('lost')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  listLost(@Query() query: ListLostQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.lost.listLostReports(tx, orgId, query.status, user.branches));
  }

  /** What the school still owes families. The whole point is that it is visible. */
  @Get('lost/refunds-owed')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  outstandingRefunds(@CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.lost.outstandingRefunds(tx, orgId, user.branches));
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
  /**
   * Money taken at the counter for any fine — a plain late return, damage,
   * anything. READERS: taking money is desk work; forgiving it is not.
   */
  @Post('fines/:id/pay')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  @UseInterceptors(IdempotencyInterceptor)
  payFine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PayFineDto,
    @CurrentUser() user: LibJwtPayload,
  ) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.fines.pay(tx, orgId, id, dto, user.sub, now, user.branches));
  }

  @Post('fines/:id/waive')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  @UseInterceptors(IdempotencyInterceptor)
  waiveFine(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: WaiveFineDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    const now = new Date();
    return withOrg(orgId, (tx) => this.fines.waive(tx, orgId, id, dto, user.sub, now, user.branches));
  }

  /**
   * The dues list, one row per MEMBER — "does Meera owe anything?", which is
   * the question a librarian actually asks. `/circulation/fines` stays as the
   * per-fine feed for drilling in.
   */
  @Get('dues')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  listDues(@Query() query: ListDuesQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.fines.listDues(tx, orgId, query, user.branches));
  }

  /** What came in, what is still owed, what was genuinely let off. */
  @Get('collections')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  collections(@Query() query: CollectionsQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.fines.collections(tx, orgId, query, user.branches));
  }

  /** Every waiver with its reason and who granted it — the log an owner reads. */
  @Get('waivers')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  waiverLog(@Query() query: WaiverLogQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.fines.waiverLog(tx, orgId, query.limit ?? 50, user.branches));
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
