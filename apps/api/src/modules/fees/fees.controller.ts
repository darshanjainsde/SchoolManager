import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { ApiError } from '../../common/errors/api-error';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { FeeBillingService } from './fee-billing.service';
import { FeeConfigService } from './fee-config.service';
import { FeePaymentService } from './fee-payment.service';
import { FeeQueryService } from './fee-query.service';
import { FeeSetupService } from './fee-setup.service';
import {
  RejectPaymentDto, ReversePaymentDto, SaveBankDetailDto, SaveCategoryDto,
  SaveConcessionDto, SaveGridDto, SaveProviderConfigDto, SaveSettingsDto, SaveTermsDto,
  SubmitPaymentDto,
} from './fees.dto';

/** 5 MB. A phone screenshot is well under this; a photo of a printed slip fits too. */
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;

/**
 * The office side of fees.
 *
 * `SCHOOL_ADMIN` and `STAFF` today. Verification is deliberately NOT gated on
 * "is admin" but on reaching this controller at all, so lifting the verify desk
 * into a central account-manager portal later is a routing and role change
 * rather than a rewrite of the service beneath it.
 */
/**
 * STAFF vs SCHOOL_ADMIN on this desk.
 *
 * The class grants SCHOOL_ADMIN and STAFF, and `STAFF` is not one job — the
 * enum covers OFFICE, SUPPORT, DRIVER, HELPER, SECURITY and LIBRARIAN. An
 * audit on 4 Sept 2026 signed in as a seeded OFFICE login and reached the
 * payment-gateway credentials, the bank account fees are routed to, and
 * payment reversal; the same token was correctly refused (403) on
 * /manage/students, which is how we know those were real authorization
 * passes and not a broken probe.
 *
 * Recording, verifying and rejecting a payment is the fee desk's daily job and
 * stays open to STAFF. What moves money, changes the fee structure, grants a
 * concession or reverses a completed payment is SCHOOL_ADMIN, marked
 * per-handler below. LibraryController narrows the same role pair with
 * LibrarianGuard; the same could be done here off Staff.role if an accounts
 * role is ever added.
 */
@Controller('manage/fees')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('FEES')
@Roles('SCHOOL_ADMIN', 'STAFF')
export class FeesController {
  constructor(
    private readonly setup: FeeSetupService,
    private readonly billing: FeeBillingService,
    private readonly payments: FeePaymentService,
    private readonly config: FeeConfigService,
    private readonly query: FeeQueryService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  // ── Step 1 · categories ───────────────────────────────────────────────────

  @Get('categories') listCategories() { return this.setup.listCategories(this.sid()); }

  /** Seeds the starter set on first open. Idempotent. */
  @Roles('SCHOOL_ADMIN')
  @Post('categories/seed') @HttpCode(200) seedCategories() { return this.setup.seedCategories(this.sid()); }

  @Roles('SCHOOL_ADMIN')
  @Put('categories') saveCategory(@Body() dto: SaveCategoryDto) {
    return this.setup.saveCategory(this.sid(), dto);
  }

  @Roles('SCHOOL_ADMIN')
  @Delete('categories/:id') archiveCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.setup.archiveCategory(this.sid(), id);
  }

  // ── Step 2 · terms ────────────────────────────────────────────────────────

  @Get('terms') listTerms(@Query('academicYearId', ParseUUIDPipe) yearId: string) {
    return this.setup.listTerms(this.sid(), yearId);
  }

  @Roles('SCHOOL_ADMIN')
  @Put('terms') saveTerms(@Body() dto: SaveTermsDto) { return this.setup.saveTerms(this.sid(), dto); }

  /**
   * The late-fee rule. Lives beside the terms because it is the other half of
   * the same decision: a due date only means something if something happens
   * when it passes.
   */
  @Get('settings') getSettings() { return this.setup.getSettings(this.sid()); }

  @Roles('SCHOOL_ADMIN')
  @Put('settings') saveSettings(@Body() dto: SaveSettingsDto) {
    return this.setup.saveSettings(this.sid(), dto);
  }

  // ── Step 3 · the grid ─────────────────────────────────────────────────────

  @Get('grid') getGrid(@Query('academicYearId', ParseUUIDPipe) yearId: string) {
    return this.setup.getGrid(this.sid(), yearId);
  }

  @Roles('SCHOOL_ADMIN')
  @Put('grid') saveGrid(@Body() dto: SaveGridDto) { return this.setup.saveGrid(this.sid(), dto); }

  // ── Step 4 · exceptions ───────────────────────────────────────────────────

  @Get('concessions') listConcessions(@Query('studentId') studentId?: string) {
    return this.setup.listConcessions(this.sid(), studentId);
  }

  @Roles('SCHOOL_ADMIN')
  @Post('concessions') saveConcession(@Body() dto: SaveConcessionDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.setup.saveConcession(this.sid(), u.sub, dto);
  }

  @Roles('SCHOOL_ADMIN')
  @Delete('concessions/:id') deleteConcession(@Param('id', ParseUUIDPipe) id: string) {
    return this.setup.deleteConcession(this.sid(), id);
  }

  // ── Step 5 · billing ──────────────────────────────────────────────────────

  /** Writes nothing. Exactly the computation `generate` will run. */
  @Get('billing/preview') preview(@Query('termId', ParseUUIDPipe) termId: string) {
    return this.billing.preview(this.sid(), termId);
  }

  @Roles('SCHOOL_ADMIN')
  @Post('billing/generate') @HttpCode(200) generate(@Body('termId', ParseUUIDPipe) termId: string) {
    return this.billing.generate(this.sid(), termId);
  }

  // ── Payment setup ─────────────────────────────────────────────────────────

  @Get('payment-setup') paymentSetup() { return this.config.getSetup(this.sid()); }

  @Roles('SCHOOL_ADMIN')
  @Put('payment-setup/bank') saveBank(@Body() dto: SaveBankDetailDto) {
    return this.config.saveBankDetail(this.sid(), dto);
  }

  @Roles('SCHOOL_ADMIN')
  @Post('payment-setup/bank/qr')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  saveQr(@UploadedFile() file?: { originalname: string; buffer: Buffer; mimetype: string }) {
    if (!file) throw new ApiError('VALIDATION', 'Choose an image to upload.', 400, 'file');
    if (!file.mimetype.startsWith('image/')) {
      throw new ApiError('VALIDATION', 'The QR code must be an image.', 400, 'file');
    }
    return this.config.saveUpiQr(this.sid(), {
      buffer: file.buffer, filename: file.originalname, contentType: file.mimetype,
    });
  }

  @Roles('SCHOOL_ADMIN')
  @Put('payment-setup/provider') saveProvider(@Body() dto: SaveProviderConfigDto) {
    return this.config.saveProviderConfig(this.sid(), dto);
  }

  // ── The verify desk ───────────────────────────────────────────────────────

  @Get('payments') payments_(
    @Query('status') status?: 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'REVERSED',
  ) {
    return this.query.paymentsToVerify(this.sid(), status ?? 'SUBMITTED');
  }

  @Post('payments/:id/verify') @HttpCode(200)
  verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.payments.verify(this.sid(), u.sub, id);
  }

  @Post('payments/:id/reject') @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectPaymentDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.payments.reject(this.sid(), u.sub, id, dto);
  }

  @Roles('SCHOOL_ADMIN')
  @Post('payments/:id/reverse') @HttpCode(200)
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReversePaymentDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.payments.reverse(this.sid(), u.sub, id, dto.reason);
  }

  /**
   * Record a payment taken at the counter. The same submit path a parent uses
   * — one queue, one day-close number — with the clerk as the submitter.
   */
  @Post('payments/record') @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROOF_BYTES } }))
  record(
    @Body() dto: SubmitPaymentDto,
    @CurrentUser() u: SchoolJwtPayload,
    @UploadedFile() file?: { originalname: string; buffer: Buffer; mimetype: string },
  ) {
    return this.payments.submit(this.sid(), u.sub, dto,
      file ? { buffer: file.buffer, filename: file.originalname, contentType: file.mimetype } : undefined);
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  @Get('summary') summary() { return this.query.collectionSummary(this.sid()); }

  @Get('students/:id') studentFees(@Param('id', ParseUUIDPipe) id: string) {
    return this.query.studentFees(this.sid(), id);
  }

  /**
   * Fees by student. ONE list, and the defaulters view is a FILTER on it
   * (`owing=1`) rather than a second screen computing the same numbers a second
   * way — Darshan's call, and it means one component and one place a bug lives.
   *
   * Every query param is a string on the wire, so the numeric and boolean ones
   * are parsed here explicitly. `apps/api`'s ValidationPipe runs WITHOUT
   * `enableImplicitConversion` on purpose, so a bare `@IsInt()` on a query DTO
   * 400s the endpoint on its own first page load.
   */
  @Get('students') studentFeeList(
    @Query('termId') termId?: string,
    @Query('gradeId') gradeId?: string,
    @Query('owing') owing?: string,
    @Query('overdue') overdue?: string,
    @Query('minDue') minDue?: string,
    @Query('q') q?: string,
    @Query('take') take?: string,
  ) {
    const minDueMinor = minDue !== undefined && minDue !== '' ? Number(minDue) : undefined;
    const takeN = take !== undefined && take !== '' ? Number(take) : undefined;
    if (minDueMinor !== undefined && !Number.isFinite(minDueMinor)) {
      throw new ApiError('VALIDATION', 'minDue must be a number of paise.', 400, 'minDue');
    }
    if (takeN !== undefined && !Number.isInteger(takeN)) {
      throw new ApiError('VALIDATION', 'take must be a whole number.', 400, 'take');
    }
    return this.query.studentFeeList(this.sid(), {
      termId: termId || undefined,
      gradeId: gradeId || undefined,
      owingOnly: owing === '1' || owing === 'true',
      overdueOnly: overdue === '1' || overdue === 'true',
      minDueMinor,
      q: q?.trim() || undefined,
      take: takeN,
    });
  }
}
