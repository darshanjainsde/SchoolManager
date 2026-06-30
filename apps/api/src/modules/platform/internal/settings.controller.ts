import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Length } from 'class-validator';
import { SettingsService } from './settings.service';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { PlatformHostGuard } from './platform-host.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { PlatformJwtPayload } from '../../../common/auth/jwt-payload';
import { AuditService } from '../../../common/audit/audit.service';

/**
 * Allow-list of setting keys to prevent owners from creating arbitrary keys
 * that the code doesn't know how to consume. Values are arbitrary strings
 * (Stripe/Resend keys are scalar; some keys are JSON-encoded blobs).
 */
const ALLOWED_KEYS = new Set([
  'stripe.secretKey',
  'stripe.publishableKey',
  'stripe.webhookSecret',
  'resend.apiKey',
  'resend.fromEmail',
  'ably.apiKey',
  'otel.endpoint',
  'otel.headers', // JSON-encoded object
  'invite.baseUrl', // override the auto-derived <slug>.PLATFORM_HOST URL
]);

export class SetSettingDto {
  @ApiProperty() @IsString() @Length(2, 80) key!: string;
  @ApiProperty() @IsString() @Length(1, 4096) value!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() asJson?: Record<string, unknown>;
}

@ApiTags('platform-settings')
@ApiBearerAuth()
@UseGuards(PlatformHostGuard, PlatformJwtGuard)
@Controller('platform/settings')
export class PlatformSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /** List keys (never values). */
  @Get()
  async list() {
    return this.settings.listKeys();
  }

  /** Health check: which integrations are wired? */
  @Get('integrations')
  async integrations() {
    const keys = await this.settings.listKeys();
    const set = new Set(keys.map((k) => k.key));
    return {
      stripe: set.has('stripe.secretKey') && set.has('stripe.webhookSecret'),
      resend: set.has('resend.apiKey') && set.has('resend.fromEmail'),
      ably: set.has('ably.apiKey'),
      otel: set.has('otel.endpoint'),
    };
  }

  @Post()
  async set(@Body() dto: SetSettingDto, @CurrentUser() owner: PlatformJwtPayload) {
    if (!ALLOWED_KEYS.has(dto.key)) {
      throw new BadRequestException(`Unknown setting key: ${dto.key}`);
    }
    const valueToStore = dto.asJson ? JSON.stringify(dto.asJson) : dto.value;
    await this.settings.set(dto.key, valueToStore, owner.sub);
    await this.audit.record({
      scope: 'PLATFORM',
      schoolId: null,
      actorId: owner.sub,
      actorType: 'platform',
      action: `POST /platform/settings`,
      targetType: 'PlatformSetting',
      targetId: dto.key,
      metadata: { keyLen: valueToStore.length },
    });
    return { ok: true, key: dto.key };
  }

  @Delete(':key')
  async unset(@Param('key') key: string, @CurrentUser() owner: PlatformJwtPayload) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new BadRequestException(`Unknown setting key: ${key}`);
    }
    await this.settings.delete(key);
    await this.audit.record({
      scope: 'PLATFORM',
      schoolId: null,
      actorId: owner.sub,
      actorType: 'platform',
      action: `DELETE /platform/settings/${key}`,
      targetType: 'PlatformSetting',
      targetId: key,
    });
    return { ok: true };
  }
}
