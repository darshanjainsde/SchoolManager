import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { CertificateService } from './certificate.service';
import { PressRegisterService } from './press-register.service';
import { ReportCardService } from './report-card.service';
import {
  IssueCertificateDto, IssueReportCardsDto, SaveRemarkDto, SaveWindowDto,
} from './press.dto';

/**
 * The office side of the Press.
 *
 * `SCHOOL_ADMIN` and `STAFF`, matching the fees desk: issuing a TC or printing
 * a term's cards is front-office work, and gating it tighter than the fee desk
 * would only route it through the principal's password.
 */
@Controller('manage/press')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('PRESS')
@Roles('SCHOOL_ADMIN', 'STAFF')
export class PressController {
  constructor(
    private readonly reportCards: ReportCardService,
    private readonly certificates: CertificateService,
    private readonly register: PressRegisterService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  // ── Report windows ────────────────────────────────────────────────────────

  @Get('windows') listWindows() {
    return this.reportCards.listWindows(this.sid());
  }

  @Put('windows') saveWindow(@Body() dto: SaveWindowDto) {
    return this.reportCards.saveWindow(this.sid(), dto);
  }

  // ── Report cards ──────────────────────────────────────────────────────────

  @Get('report-cards/:windowId/:classSectionId')
  compileBatch(
    @Param('windowId', ParseUUIDPipe) windowId: string,
    @Param('classSectionId', ParseUUIDPipe) classSectionId: string,
  ) {
    return this.reportCards.compileBatch(this.sid(), windowId, classSectionId);
  }

  @Put('remarks') saveRemark(@CurrentUser() u: SchoolJwtPayload, @Body() dto: SaveRemarkDto) {
    return this.reportCards.saveRemark(this.sid(), dto, u.sub);
  }

  @Post('report-cards/issue') @HttpCode(200)
  issueReportCards(@CurrentUser() u: SchoolJwtPayload, @Body() dto: IssueReportCardsDto) {
    return this.reportCards.issueBatch(this.sid(), dto, u.sub);
  }

  // ── Certificates ──────────────────────────────────────────────────────────

  @Get('certificates/prepare/:studentId')
  prepareCertificate(@Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.certificates.prepare(this.sid(), studentId);
  }

  @Post('certificates/issue') @HttpCode(201)
  issueCertificate(@CurrentUser() u: SchoolJwtPayload, @Body() dto: IssueCertificateDto) {
    return this.certificates.issue(this.sid(), dto, u.sub);
  }

  // ── The register ──────────────────────────────────────────────────────────

  @Get('register')
  listRegister(
    @Query('type') type?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.register.list(this.sid(), { type, q, cursor });
  }

  @Get('register/:id')
  oneIssue(@Param('id', ParseUUIDPipe) id: string) {
    return this.register.one(this.sid(), id);
  }
}
