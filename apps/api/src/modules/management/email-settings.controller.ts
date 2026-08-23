import { Body, Controller, Get, HttpCode, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { EmailSettingsService } from './email-settings.service';
import { SendTestEmailDto, UpdateEmailSenderDto, UpdateEmailSettingsDto, VerifyEmailSenderDto } from './management.dto';
import type { EmailTemplate } from '../../common/mail/letterhead';

/**
 * How this school's email looks and who it comes from.
 *
 * SCHOOL_ADMIN only, throughout: the sender settings hold a mailbox credential
 * and the letterhead is the school's public face — neither is a teacher's to
 * change.
 */
@Controller('manage/email-settings')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class EmailSettingsController {
  constructor(
    private readonly settings: EmailSettingsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  get() {
    return this.settings.get(this.sid());
  }

  /** Live preview of a letterhead the admin has not saved yet. */
  @Get('preview')
  preview(@Query('template') template?: string, @Query('accentColor') accentColor?: string) {
    const t: EmailTemplate =
      template === 'BANNER' || template === 'MINIMAL' ? template : 'CLASSIC';
    return this.settings.preview(this.sid(), t, accentColor);
  }

  @Put()
  update(@Body() dto: UpdateEmailSettingsDto) {
    return this.settings.update(this.sid(), dto);
  }

  @Put('sender')
  updateSender(@Body() dto: UpdateEmailSenderDto) {
    return this.settings.updateSender(this.sid(), dto);
  }

  /** Sends a real message with the saved credentials; success flips the school over. */
  @Post('sender/verify')
  @HttpCode(200)
  verifySender(@Body() dto: VerifyEmailSenderDto) {
    return this.settings.verifySender(this.sid(), dto);
  }

  @Post('sender/disable')
  @HttpCode(200)
  disableSender() {
    return this.settings.disableSender(this.sid());
  }

  /** Sends a sample through whatever is in force right now. */
  @Post('test')
  @HttpCode(200)
  sendTest(@Body() dto: SendTestEmailDto) {
    return this.settings.sendTest(this.sid(), dto.to);
  }
}
