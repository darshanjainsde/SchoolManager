import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { RequireFeature } from '../../features';
import { TenantContextService } from '../../tenancy';
import { OnboardingService } from './onboarding.service';
import type { SheetKind } from './onboarding.sheets';

const KINDS: SheetKind[] = ['teachers', 'students', 'classes'];
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('manage/onboarding')
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
@RequireFeature('MANAGEMENT')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService, private readonly tenant: TenantContextService) {}
  private sid() { return this.tenant.requireTenant().schoolId; }
  private kind(k: string): SheetKind {
    if (!KINDS.includes(k as SheetKind)) throw new BadRequestException(`Unknown sheet "${k}". One of: ${KINDS.join(', ')}.`);
    return k as SheetKind;
  }

  @Get('template/:kind')
  async template(@Param('kind') k: string, @Res() res: Response) {
    const kind = this.kind(k);
    const buf = await this.onboarding.template(this.sid(), kind);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="sckools-${kind}-template.xlsx"`);
    res.send(buf);
  }

  /** The home's numbers and the import history. */
  @Get('status')
  status() {
    return this.onboarding.status(this.sid());
  }

  /** Before export/:kind on purpose — "all" is not a sheet kind. */
  @Get('export/all')
  async exportAll(@Res() res: Response) {
    const buf = await this.onboarding.exportAll(this.sid());
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="sckools-school-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  }

  @Get('export/:kind')
  async export(@Param('kind') k: string, @Res() res: Response) {
    const kind = this.kind(k);
    const buf = await this.onboarding.export(this.sid(), kind);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="sckools-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  }

  /** Check only. Returns every problem, row by row. Writes nothing. */
  @Post('preview/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024 } }))
  async preview(@Param('kind') k: string, @UploadedFile() file: Express.Multer.File, @Query('academicYearId') academicYearId?: string) {
    if (!file) throw new BadRequestException('Attach the filled-in workbook as "file".');
    const { rows: _rows, ...report } = await this.onboarding.preview(this.sid(), this.kind(k), file.buffer, { academicYearId });
    return report;
  }

  /** Create. Refuses unless the same file previews clean. */
  @Post('import/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024 } }))
  async import(@Param('kind') k: string, @UploadedFile() file: Express.Multer.File, @Query('academicYearId') academicYearId?: string, @Body() _body?: unknown) {
    if (!file) throw new BadRequestException('Attach the filled-in workbook as "file".');
    return this.onboarding.import(this.sid(), this.kind(k), file.buffer, { academicYearId, fileName: file.originalname });
  }
}
