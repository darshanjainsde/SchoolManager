import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

/** Off a phone, in a school office, on a patchy connection. */
const MAX_GIFT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { TenantContextService } from '../../tenancy';
import { AlumniService } from './alumni.service';
import { AlumniAuthService } from './alumni-auth.service';
import { GiftsService } from './gifts.service';
import { GuestSessionsService } from './guest-sessions.service';
import {
  AttachGiftDto,
  CreateAlumniAccountDto,
  CreatePledgeDto,
  DecideClaimDto,
  DecidePledgeDto,
  DecideSessionDto,
  DistributeGiftDto,
  GraduateBatchDto,
  ListAlumniQueryDto,
  MarkPickedUpDto,
  PurchaseGiftDto,
  ReceiveGiftDto,
  RequestPickupDto,
  RequestSessionDto,
  SaveBatchStrengthDto,
  SaveGiftItemDto,
  SetTrustedDto,
  SlotsQueryDto,
  ThankYouDto,
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
    private readonly alumniAuth: AlumniAuthService,
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

  /**
   * Mint a claim link for one alumnus, and return the raw token ONCE.
   *
   * The office copies it into the batch WhatsApp group — which is the outreach
   * design, costs nothing, and lands where these people actually are. No SMS:
   * transactional SMS in India needs a gateway with a per-message cost AND DLT
   * registration of the sender id and every template, which is a lead-time item
   * rather than a switch.
   */
  @Post(':id/claim-link')
  claimLink(@Param('id', ParseUUIDPipe) id: string) {
    return this.alumniAuth.mintClaimToken(this.sid(), id);
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

  /**
   * Give a verified alumnus an ordinary account.
   *
   * Returns a readable temporary password ONCE. Nothing stores it and there is
   * no way to read it back — the office hands it over the way it hands over
   * everything else here, in a WhatsApp message. The student flow emails an
   * invite instead; that is not available to us until SMTP_PASS exists on
   * Preview, and an invite nobody receives is worse than no invite.
   */
  @Post(':id/account')
  createAccount(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAlumniAccountDto) {
    return this.alumniAuth.createAccount(this.sid(), id, dto.email);
  }

  // ─── "Send me my link" queue ───────────────────────────────────────────────

  @Get('link-requests')
  linkRequests() {
    return this.alumni.listLinkRequests(this.sid());
  }

  /** Marks it sent. The office still does the sending — it pastes the link into
   *  the batch WhatsApp group, which is where these people actually are. */
  @Post('link-requests/:id/sent')
  markLinkSent(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.alumni.closeLinkRequest(this.sid(), id, u.sub, true);
  }

  @Post('link-requests/:id/dismiss')
  dismissLinkRequest(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.alumni.closeLinkRequest(this.sid(), id, u.sub, false);
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

  /** Either the office or the donor may arrange collection; this is the
   *  office's door, and it passes no alumniId because its guard is the tenant
   *  role, not ownership of the pledge. */
  @Post('pledges/:id/request-pickup')
  requestPickup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestPickupDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.gifts.requestPickup(this.sid(), id, { userId: u.sub }, dto);
  }

  @Post('pledges/:id/picked-up')
  markPickedUp(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkPickedUpDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.gifts.markPickedUp(this.sid(), id, { userId: u.sub }, dto);
  }

  @Post('pledges/:id/purchase')
  purchase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurchaseGiftDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.gifts.purchase(this.sid(), id, u.sub, dto);
  }

  /** The school's word back. Not a status, so it has its own route and can be
   *  written or corrected at any point once the gift is real. */
  @Post('pledges/:id/thank-you')
  thankYou(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ThankYouDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.gifts.thankYou(this.sid(), id, u.sub, dto);
  }

  /**
   * Bills and photographs. Capped at 8 MB because these come off a phone in a
   * school office on a patchy connection, and a 40 MB upload that fails twice
   * is a feature nobody uses.
   */
  @Post('pledges/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_GIFT_ATTACHMENT_BYTES } }))
  attach(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { originalname: string; buffer: Buffer; mimetype: string },
    @Body() dto: AttachGiftDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.gifts.attach(this.sid(), id, u.sub, file, dto);
  }

  @Delete('pledges/:id/attachments/:attachmentId')
  removeAttachment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ) {
    return this.gifts.removeAttachment(this.sid(), id, attachmentId);
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
