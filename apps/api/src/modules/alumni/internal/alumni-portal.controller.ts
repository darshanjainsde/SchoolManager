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
import { GiftsService } from './gifts.service';
import { GuestSessionsService } from './guest-sessions.service';
import {
  AlumniSessionGuard,
  RequireTrustedAlumnus,
  type AlumniRequest,
} from './alumni-session.guard';
import {
  CreatePledgeDto,
  DecideSessionDto,
  DirectoryQueryDto,
  RedeemClaimDto,
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

  @Get('pledges')
  myPledges(@Req() req: AlumniRequest) {
    return this.gifts.listPledgesForAlumnus(this.sid(), this.who(req).alumniId);
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
