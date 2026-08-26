import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { TenantContextService } from '../../tenancy';
import { AlumniService } from './alumni.service';
import { GiftsService } from './gifts.service';
import { GuestSessionsService } from './guest-sessions.service';
import {
  CreatePledgeDto,
  DecideClaimDto,
  DecidePledgeDto,
  DecideSessionDto,
  DistributeGiftDto,
  GraduateBatchDto,
  ListAlumniQueryDto,
  ReceiveGiftDto,
  RequestSessionDto,
  SaveBatchStrengthDto,
  SaveGiftItemDto,
  SetTrustedDto,
  SlotsQueryDto,
} from './alumni.dto';

/**
 * The Alumni Office — everything the school's side of Homecoming does.
 *
 * Gated on SCHOOL_ADMIN for now. The pitch puts an ALUMNI_COORDINATOR on the
 * Staff record (the job decides the door, in the shape the Library Wing proved),
 * and that arrives with the staff-facing slice rather than being half-wired here.
 */
@Controller('manage/alumni')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('ALUMNI')
@Roles('SCHOOL_ADMIN')
export class AlumniController {
  constructor(
    private readonly alumni: AlumniService,
    private readonly gifts: GiftsService,
    private readonly sessions: GuestSessionsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  // ─── Roster and dashboard ──────────────────────────────────────────────────

  @Get('summary')
  summary() {
    return this.alumni.summary(this.sid());
  }

  @Get()
  list(@Query() q: ListAlumniQueryDto) {
    return this.alumni.list(this.sid(), q);
  }

  @Post('graduate')
  graduate(@Body() dto: GraduateBatchDto) {
    return this.alumni.graduateBatch(this.sid(), dto);
  }

  @Get('roll-call')
  rollCall() {
    return this.alumni.rollCall(this.sid());
  }

  @Put('roll-call')
  saveStrength(@Body() dto: SaveBatchStrengthDto) {
    return this.alumni.saveBatchStrength(this.sid(), dto);
  }

  @Put(':id/trusted')
  setTrusted(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetTrustedDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.alumni.setTrusted(this.sid(), id, u.sub, dto);
  }

  // ─── Claims ────────────────────────────────────────────────────────────────

  @Get('claims')
  claims(@Query('status') status?: string) {
    return this.alumni.listClaims(this.sid(), status);
  }

  @Post('claims/:id/decide')
  decideClaim(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideClaimDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.alumni.decideClaim(this.sid(), id, u.sub, dto);
  }

  // ─── Gifts ─────────────────────────────────────────────────────────────────

  @Get('gift-items')
  giftItems(@Query('all') all?: string) {
    return this.gifts.listItems(this.sid(), all === '1');
  }

  @Post('gift-items')
  createItem(@Body() dto: SaveGiftItemDto) {
    return this.gifts.saveItem(this.sid(), null, dto);
  }

  @Put('gift-items/:id')
  updateItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveGiftItemDto) {
    return this.gifts.saveItem(this.sid(), id, dto);
  }

  /** Counts, never children. The only thing a donor is shown about the people
   *  they are giving to. */
  @Get('gift-groups')
  giftGroups() {
    return this.gifts.groups(this.sid());
  }

  @Get('pledges')
  pledges(@Query('status') status?: string) {
    return this.gifts.listPledges(this.sid(), status);
  }

  /** Present so the office can record a gift somebody offered over the counter.
   *  The alumnus-facing route arrives with the passwordless door. */
  @Post('pledges')
  createPledge(@Body() dto: CreatePledgeDto) {
    return this.gifts.createPledge(this.sid(), dto);
  }

  @Post('pledges/:id/decide')
  decidePledge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecidePledgeDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.gifts.decide(this.sid(), id, u.sub, dto);
  }

  @Post('pledges/:id/receive')
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveGiftDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.gifts.receive(this.sid(), id, u.sub, dto);
  }

  @Post('pledges/:id/distribute')
  distribute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DistributeGiftDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.gifts.distribute(this.sid(), id, u.sub, dto);
  }

  @Post('pledges/:id/report')
  report(@Param('id', ParseUUIDPipe) id: string) {
    return this.gifts.report(this.sid(), id);
  }

  // ─── Guest sessions ────────────────────────────────────────────────────────

  /** OFFICE audience: this response carries the subject and the teacher. The
   *  alumnus-facing route asks for the same periods with audience ALUMNUS and
   *  those fields are never written onto the object. */
  @Get('slots')
  slots(@Query() q: SlotsQueryDto) {
    return this.sessions.slots(this.sid(), q, 'OFFICE');
  }

  @Get('sessions')
  listSessions(@Query('status') status?: string) {
    return this.sessions.list(this.sid(), status);
  }

  /** Present so the office can enter a request that arrived by phone. */
  @Post('sessions')
  requestSession(@Body() dto: RequestSessionDto) {
    return this.sessions.request(this.sid(), dto);
  }

  @Get('sessions/:id/conflicts')
  conflicts(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.conflicts(this.sid(), id);
  }

  @Post('sessions/:id/decide')
  decideSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideSessionDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.sessions.decide(this.sid(), id, u.sub, 'SCHOOL', dto);
  }

  /**
   * The host's side of the counter-offer, exercised BY THE OFFICE on the host's
   * behalf — the alumnus's own door is slice 2. It is a separate route rather
   * than a flag on the one above so that the actor is never client-supplied:
   * `decideSession` takes 'SCHOOL' and this takes 'HOST', and neither can be
   * talked into the other by a request body.
   */
  @Post('sessions/:id/decide-as-host')
  decideAsHost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideSessionDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.sessions.decide(this.sid(), id, u.sub, 'HOST', dto);
  }
}
