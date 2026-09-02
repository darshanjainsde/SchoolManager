import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../../common/auth/public.decorator';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { TenantContextService } from '../../tenancy';
import { AlumniAuthService } from './alumni-auth.service';
import { AlumniPortalService } from './alumni-portal.service';
import { AlumniService } from './alumni.service';
import { GiftsService } from './gifts.service';
import { GuestSessionsService } from './guest-sessions.service';
import {
  AlumniSessionGuard,
  RequireTrustedAlumnus,
  type AlumniRequest,
} from './alumni-session.guard';
import {
  AlumniLoginDto,
  ChangeAlumniPasswordDto,
  CreateClaimDto,
  CreatePledgeDto,
  DecideSessionDto,
  DirectoryQueryDto,
  MarkPickedUpDto,
  RedeemClaimDto,
  RequestLinkDto,
  RequestPickupDto,
  RequestSessionDto,
  SlotsQueryDto,
  UpdateMeDto,
} from './alumni.dto';

/**
 * Everything an alumnus, or a passer-by, can reach.
 *
 * Split into three controllers on purpose, because the audience is the security
 * boundary and a single controller with per-handler decorators is how a route
 * ends up in the wrong bucket:
 *
 *   PublicAlumniController   — no login at all. Batch pages, so a search engine
 *                              can index them and the alumnus in Dubai finds
 *                              himself. This is the recovery engine.
 *   AlumniPortalController   — a verified alumnus with a session.
 *   TrustedAlumnusController — additionally cleared to work with students.
 */

@Controller('alumni')
@UseGuards(RequireFeatureGuard)
@RequireFeature('ALUMNI')
export class PublicAlumniController {
  constructor(
    private readonly portal: AlumniPortalService,
    private readonly auth: AlumniAuthService,
    private readonly alumni: AlumniService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  /** The index of batch pages. Public and indexable, deliberately. */
  @Public()
  @Get('batches')
  batches() {
    return this.portal.publicBatchIndex(this.sid());
  }

  /**
   * One batch page. `ParseIntPipe` plus explicit bounds — a year is a path
   * segment here, so it is the one place a caller controls an integer that
   * reaches a query without passing through a DTO.
   */
  @Public()
  @Get('batches/:year')
  batch(@Param('year', ParseIntPipe) year: number) {
    const y = Math.trunc(year);
    if (y < 1900 || y > 2100) return { batchYear: y, found: 0, registerStrength: 0, coverage: null, stillMissing: 0, alumni: [] };
    return this.portal.publicBatch(this.sid(), y);
  }

  /**
   * "I was a student here."
   *
   * The public front door to the verification queue, and the only write an
   * unauthenticated stranger can make in this module. It creates an inert
   * AlumniClaim and nothing else: no status, no visibility, no login. A human
   * in the office matches it against the bound register, and only then does
   * anybody exist to another human being.
   */
  @Public()
  @Post('claims')
  submitClaim(@Body() dto: CreateClaimDto) {
    return this.alumni.submitClaim(this.sid(), dto);
  }

  /**
   * "I am already registered — send me my link."
   *
   * Public, because the whole point is that the caller has no session. The
   * answer is identical whether or not the contact matches anybody, so this
   * cannot be used to ask whether an address belongs to an alumnus here.
   */
  @Public()
  @Post('link-request')
  requestLink(@Body() dto: RequestLinkDto) {
    return this.alumni.requestLink(this.sid(), dto);
  }

  /**
   * The ordinary login, for alumni the school has given an account.
   *
   * Public because the caller has no session yet — that is the point. It mints
   * the SAME AlumniAccessToken a claim link would, so there is one session
   * concept and the guard downstream is unchanged.
   */
  @Public()
  @Post('login')
  async login(@Body() dto: AlumniLoginDto) {
    const r = await this.auth.loginWithPassword(this.sid(), dto.email, dto.password);
    return { session: r.session, expiresAt: r.expiresAt, alumni: r.alumni };
  }

  /**
   * Redeem a claim link for a device session.
   *
   * Public because the whole point is that the holder has no session yet. The
   * token in the body, never the query string: a token in a URL lands in server
   * logs and in the Referer header of every outbound link on the page.
   */
  @Public()
  @Post('claim')
  async claim(@Body() dto: RedeemClaimDto) {
    const r = await this.auth.redeemClaim(this.sid(), dto.token);
    return { session: r.session, expiresAt: r.expiresAt, alumni: r.alumni };
  }
}

@Controller('alumni/me')
@UseGuards(RequireFeatureGuard, AlumniSessionGuard)
@RequireFeature('ALUMNI')
export class AlumniPortalController {
  constructor(
    private readonly portal: AlumniPortalService,
    private readonly gifts: GiftsService,
    private readonly auth: AlumniAuthService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  private who(req: AlumniRequest) {
    // Set by AlumniSessionGuard. Never read from the body — an actor a caller
    // can name is not an actor.
    return req.alumnus!;
  }

  @Get()
  me(@Req() req: AlumniRequest) {
    return this.portal.me(this.sid(), this.who(req).alumniId);
  }

  @Put()
  updateMe(@Req() req: AlumniRequest, @Body() dto: UpdateMeDto) {
    return this.portal.updateMe(this.sid(), this.who(req).alumniId, dto);
  }

  /** An alumnus sets their own password, replacing the temporary one the office
   *  handed over. Requires the current one, so a borrowed 90-day session on a
   *  shared phone cannot lock the owner out of their own account. */
  @Put('password')
  changePassword(@Req() req: AlumniRequest, @Body() dto: ChangeAlumniPasswordDto) {
    return this.auth.changePassword(
      this.sid(), this.who(req).alumniId, dto.currentPassword, dto.newPassword,
    );
  }

  @Post('sign-out')
  async signOut(@Req() req: Request) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token) await this.auth.revokeSession(this.sid(), token);
    return { ok: true };
  }

  /** The directory. Verified alumni only, as the audience and as the rows. */
  @Get('directory')
  directory(@Req() req: AlumniRequest, @Query() q: DirectoryQueryDto) {
    return this.portal.directory(this.sid(), this.who(req).batchYear, q);
  }

  /** Counts, never children — the only thing a donor sees about the people
   *  they are giving to. */
  @Get('gift-groups')
  giftGroups() {
    return this.gifts.groups(this.sid());
  }

  @Get('gift-items')
  giftItems() {
    return this.gifts.listItems(this.sid());
  }

  /**
   * Pledge a gift.
   *
   * `alumniId` is taken from the SESSION, not the body. The DTO carries one so
   * the office route can record a gift offered over the counter; letting an
   * alumnus name a different alumnus would let anybody pledge in somebody
   * else's name, which is a small fraud with a real dedication attached to it.
   */
  @Post('pledges')
  pledge(@Req() req: AlumniRequest, @Body() dto: CreatePledgeDto) {
    return this.gifts.createPledge(this.sid(), {
      ...dto,
      alumniId: this.who(req).alumniId,
      donorName: undefined,
      donorEmail: undefined,
    });
  }

  /**
   * Everything they have given, with the story of each.
   *
   * The screen that decides whether somebody gives twice: a donation that
   * vanishes into an institution and is never mentioned again reads as having
   * been unwelcome.
   */
  @Get('pledges')
  myPledges(@Req() req: AlumniRequest) {
    return this.gifts.listPledgesForAlumnus(this.sid(), this.who(req).alumniId);
  }

  @Get('giving')
  myGiving(@Req() req: AlumniRequest) {
    return this.gifts.givingSummary(this.sid(), this.who(req).alumniId);
  }

  /**
   * The donor's side of collection. `alumniId` comes from the SESSION and the
   * service checks the pledge is theirs — a donor may arrange a pickup for
   * their own gift and for nobody else's.
   */
  @Post('pledges/:id/request-pickup')
  requestPickup(
    @Req() req: AlumniRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestPickupDto,
  ) {
    return this.gifts.requestPickup(this.sid(), id, { alumniId: this.who(req).alumniId }, dto);
  }

  /** "It has gone." The donor usually knows before the school does — they are
   *  the one who handed it to the courier. */
  @Post('pledges/:id/picked-up')
  markPickedUp(
    @Req() req: AlumniRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPickedUpDto,
  ) {
    return this.gifts.markPickedUp(this.sid(), id, { alumniId: this.who(req).alumniId }, dto);
  }
}

/**
 * The only surface that puts an adult in a room with children, so it sits
 * behind a second flag the school grants by hand and can revoke in one click.
 */
@Controller('alumni/me/sessions')
@UseGuards(RequireFeatureGuard, AlumniSessionGuard)
@RequireFeature('ALUMNI')
@RequireTrustedAlumnus()
export class TrustedAlumnusController {
  constructor(
    private readonly sessions: GuestSessionsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  /**
   * Real periods, real times, real availability — and never a subject or a
   * teacher's name. `'ALUMNUS'` is passed as the audience so those fields are
   * never written onto the object, rather than written and stripped.
   */
  @Get('slots')
  slots(@Query() q: SlotsQueryDto) {
    return this.sessions.slots(this.sid(), q, 'ALUMNUS');
  }

  @Get()
  mine(@Req() req: AlumniRequest) {
    return this.sessions.listForAlumnus(this.sid(), req.alumnus!.alumniId);
  }

  @Post()
  request(@Req() req: AlumniRequest, @Body() dto: RequestSessionDto) {
    return this.sessions.request(this.sid(), { ...dto, alumniId: req.alumnus!.alumniId });
  }

  /**
   * The host's side of the counter-offer. The actor is 'HOST' because of the
   * route it arrived on, never because of anything in the body — and the
   * service checks the session belongs to this alumnus.
   */
  @Post(':id/decide')
  decide(
    @Req() req: AlumniRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideSessionDto,
  ) {
    return this.sessions.decideAsAlumnus(this.sid(), id, req.alumnus!.alumniId, dto);
  }
}
