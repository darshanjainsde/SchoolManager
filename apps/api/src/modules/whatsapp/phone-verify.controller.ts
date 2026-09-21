import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsString, Length, MaxLength } from 'class-validator';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { PhoneVerifyService } from './phone-verify.service';

export class RequestPhoneCodeDto {
  @IsString()
  @MaxLength(24)
  phone!: string;
}
export class VerifyPhoneCodeDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}

/** A person's own WhatsApp number — admin, teacher or staff; never a student's login. */
@Controller('me/phone')
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN', 'TEACHER', 'STAFF')
export class PhoneVerifyController {
  constructor(
    private readonly svc: PhoneVerifyService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  status(@CurrentUser() u: SchoolJwtPayload) {
    return this.svc.status(this.sid(), u.sub);
  }

  @Post('request')
  @HttpCode(200)
  request(@Body() dto: RequestPhoneCodeDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.request(this.sid(), u.sub, dto.phone);
  }

  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifyPhoneCodeDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.verify(this.sid(), u.sub, dto.code);
  }

  @Delete()
  clear(@CurrentUser() u: SchoolJwtPayload) {
    return this.svc.clear(this.sid(), u.sub);
  }
}
