import {
  Body, Controller, Get, HttpCode, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { ApiError } from '../../common/errors/api-error';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { FeePortalService } from './fee-portal.service';
import { MAX_PROOF_BYTES } from './fees.controller';
import { SubmitPaymentDto } from './fees.dto';

/**
 * `/me/fees/*` — the student and parent surface, web and app alike.
 *
 * There is deliberately no student id parameter anywhere here: the row is
 * always resolved from the caller's own JWT, matching `PortalController`.
 */
@Controller('me/fees')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('FEES')
@Roles('STUDENT')
export class FeePortalController {
  constructor(private readonly portal: FeePortalService) {}

  @Get() myFees(@CurrentUser() u: SchoolJwtPayload) { return this.portal.myFees(u.sub); }

  @Get('how-to-pay') howToPay(@CurrentUser() u: SchoolJwtPayload) { return this.portal.howToPay(u.sub); }

  @Get('bank-instructions')
  bankInstructions(@CurrentUser() u: SchoolJwtPayload, @Query('invoiceId') invoiceId?: string) {
    return this.portal.bankInstructions(u.sub, invoiceId);
  }

  /**
   * Multipart, because the screenshot rides along with the claim. A proof is
   * optional — a parent who paid cash at the office has none, and refusing the
   * claim for want of an image would push them back to the counter.
   */
  @Post('submit') @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PROOF_BYTES } }))
  submit(
    @CurrentUser() u: SchoolJwtPayload,
    @Body() dto: SubmitPaymentDto,
    @UploadedFile() file?: { originalname: string; buffer: Buffer; mimetype: string },
  ) {
    if (file && !file.mimetype.startsWith('image/')) {
      throw new ApiError('VALIDATION', 'The proof must be an image (JPG or PNG).', 400, 'file');
    }
    return this.portal.submit(u.sub, dto,
      file ? { buffer: file.buffer, filename: file.originalname, contentType: file.mimetype } : undefined);
  }
}
