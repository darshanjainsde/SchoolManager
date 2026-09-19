import { Body, Controller, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { WhatsAppSettingsService } from './whatsapp-settings.service';

export class UpdateWhatsAppSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** Empty string clears the school's own number and falls back to the platform's. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phoneNumberId?: string | null;
}

export class SendWhatsAppTestDto {
  @IsString()
  @MaxLength(24)
  to!: string;
}

/** SCHOOL_ADMIN only: the switch decides what every family of the school receives. */
@Controller('manage/whatsapp-settings')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class WhatsAppSettingsController {
  constructor(
    private readonly settings: WhatsAppSettingsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  get() {
    return this.settings.get(this.sid());
  }

  @Put()
  update(@Body() dto: UpdateWhatsAppSettingsDto) {
    return this.settings.update(this.sid(), dto);
  }

  @Post('test')
  @HttpCode(200)
  test(@Body() dto: SendWhatsAppTestDto) {
    return this.settings.sendTest(this.sid(), dto.to);
  }
}
