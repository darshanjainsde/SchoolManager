import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { MeProfileService } from './me-profile.service';

export class NotifyPrefsDto {
  @IsOptional() @IsBoolean() leave?: boolean;
  @IsOptional() @IsBoolean() register?: boolean;
  @IsOptional() @IsBoolean() fees?: boolean;
  @IsOptional() @IsBoolean() enquiry?: boolean;
  @IsOptional() @IsBoolean() summary?: boolean;
}

export class UpdateMeProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => NotifyPrefsDto)
  notifyPrefs?: NotifyPrefsDto;
}

/**
 * A person's own page (design §5): the name on their login and what reaches
 * them on WhatsApp. The phone lives at /me/phone (verified by code); the
 * password at /auth/change-password. Families have no page of their own.
 */
@Controller('me/profile')
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN', 'TEACHER', 'STAFF')
export class MeProfileController {
  constructor(private readonly svc: MeProfileService) {}

  @Get()
  get(@CurrentUser() u: SchoolJwtPayload) {
    return this.svc.get(u.schoolId, u.sub);
  }

  @Patch()
  update(@CurrentUser() u: SchoolJwtPayload, @Body() dto: UpdateMeProfileDto) {
    return this.svc.update(u.schoolId, u.sub, dto);
  }
}
