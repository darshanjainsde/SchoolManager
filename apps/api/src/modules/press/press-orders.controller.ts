import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UploadedFile, UseGuards, UseInterceptors,
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
import { MAX_ORDER_PDF_BYTES, PressOrdersService } from './press-orders.service';
import { CancelOrderDto, CreateReportCardOrderDto, CreateUploadOrderDto } from './press-orders.dto';

/**
 * The school's order counter: hand the printing to Sckools. Same guard stack
 * as the rest of the Press — placing a print order is front-office work.
 */
@Controller('manage/press/orders')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('PRESS')
@Roles('SCHOOL_ADMIN', 'STAFF')
export class PressOrdersController {
  constructor(
    private readonly orders: PressOrdersService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list() {
    return this.orders.list(this.sid());
  }

  @Get(':id')
  one(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.one(this.sid(), id);
  }

  /** Bulk-print an issued report-card batch. */
  @Post('report-cards') @HttpCode(201)
  createForReportCards(@CurrentUser() u: SchoolJwtPayload, @Body() dto: CreateReportCardOrderDto) {
    return this.orders.createForReportCards(this.sid(), dto, u.sub);
  }

  /** Print an uploaded PDF — exam papers, circulars, forms. */
  @Post('upload') @HttpCode(201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ORDER_PDF_BYTES } }))
  createForUpload(
    @CurrentUser() u: SchoolJwtPayload,
    @Body() dto: CreateUploadOrderDto,
    @UploadedFile() file?: { originalname: string; buffer: Buffer; mimetype: string },
  ) {
    if (!file) throw new ApiError('VALIDATION', 'Attach the PDF to print.', 400, 'file');
    return this.orders.createForUpload(this.sid(), dto, file, u.sub);
  }

  /** Accept the quote — price and promised date freeze here. */
  @Post(':id/confirm') @HttpCode(200)
  confirm(@CurrentUser() u: SchoolJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.confirm(this.sid(), id, u.sub);
  }

  @Post(':id/cancel') @HttpCode(200)
  cancel(
    @CurrentUser() u: SchoolJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orders.cancel(this.sid(), id, dto, u.sub);
  }
}
