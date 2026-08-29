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
  SaveConcessionDto, SaveGridDto, SaveProviderConfigDto, SaveTermsDto, SubmitPaymentDto,
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
  @Post('categories/seed') @HttpCode(200) seedCategories() { return this.setup.seedCategories(this.sid()); }

  @Put('categories') saveCategory(@Body() dto: SaveCategoryDto) {
    return this.setup.saveCategory(this.sid(), dto);
  }

  @Delete('categories/:id') archiveCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.setup.archiveCategory(this.sid(), id);
  }

  // ── Step 2 · terms ────────────────────────────────────────────────────────

  @Get('terms') listTerms(@Query('academicYearId', ParseUUIDPipe) yearId: string) {
    return this.setup.listTerms(this.sid(), yearId);
  }

  @Put('terms') saveTerms(@Body() dto: SaveTermsDto) { return this.setup.saveTerms(this.sid(), dto); }

  // ── Step 3 · the grid ─────────────────────────────────────────────────────

  @Get('grid') getGrid(@Query('academicYearId', ParseUUIDPipe) yearId: string) {
    return this.setup.getGrid(this.sid(), yearId);
  }

  @Put('grid') saveGrid(@Body() dto: SaveGridDto) { return this.setup.saveGrid(this.sid(), dto); }

  // ── Step 4 · exceptions ───────────────────────────────────────────────────

  @Get('concessions') listConcessions(@Query('studentId') studentId?: string) {
    return this.setup.listConcessions(this.sid(), studentId);
  }

  @Post('concessions') saveConcession(@Body() dto: SaveConcessionDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.setup.saveConcession(this.sid(), u.sub, dto);
  }

  @Delete('concessions/:id') deleteConcession(@Param('id', ParseUUIDPipe) id: string) {
    return this.setup.deleteConcession(this.sid(), id);
  }

  // ── Step 5 · billing ──────────────────────────────────────────────────────

  /** Writes nothing. Exactly the computation `generate` will run. */
  @Get('billing/preview') preview(@Query('termId', ParseUUIDPipe) termId: string) {
    return this.billing.preview(this.sid(), termId);
  }

  @Post('billing/generate') @HttpCode(200) generate(@Body('termId', ParseUUIDPipe) termId: string) {
    return this.billing.generate(this.sid(), termId);
  }

  // ── Payment setup ─────────────────────────────────────────────────────────

  @Get('payment-setup') paymentSetup() { return this.config.getSetup(this.sid()); }

  @Put('payment-setup/bank') saveBank(@Body() dto: SaveBankDetailDto) {
    return this.config.saveBankDetail(this.sid(), dto);
  }

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

  @Put('payment-setup/provider') saveProvider(@Body() dto: SaveProviderConfigDto) {
    return this.config.saveProviderConfig(this.sid(), dto);
  }

  // ── The verify desk ───────────────────────────────────────────────────────

  @Get('payments') payments_(
    @Query('status') status?: 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'REVERSED',
  ) {
    return this.query.paymentsToVerify(this.sid(), status ?? 'SUBMITTED');
  }

  @Get('payments/pending-count') pendingCount() { return this.query.pendingCount(this.sid()); }

  @Post('payments/:id/verify') @HttpCode(200)
  verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.payments.verify(this.sid(), u.sub, id);
  }

  @Post('payments/:id/reject') @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectPaymentDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.payments.reject(this.sid(), u.sub, id, dto);
  }

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

  @Get('defaulters') defaulters(
    @Query('termId') termId?: string,
    @Query('gradeId') gradeId?: string,
    @Query('minDueMinor') minDueMinor?: string,
    @Query('overdueOnly') overdueOnly?: string,
  ) {
    return this.query.defaulters(this.sid(), {
      termId, gradeId,
      minDueMinor: minDueMinor ? Number(minDueMinor) : undefined,
      overdueOnly: overdueOnly === 'true',
    });
  }
}
