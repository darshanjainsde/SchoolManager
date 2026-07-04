import { IsBoolean, IsDateString, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class OwnerLoginDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 200) password!: string;
  // MFA is optional: verified only when a code is supplied.
  @IsOptional() @Matches(/^\d{6}$/) totp?: string;
}

export class RefreshDto {
  @IsString() refreshToken!: string;
}

export class CreateSchoolDto {
  @IsString() @Length(2, 120) name!: string;
  @IsString() @Matches(/^[a-z0-9-]{2,40}$/) slug!: string;
  @IsIn(['BASIC', 'STANDARD', 'PRO']) tier!: 'BASIC' | 'STANDARD' | 'PRO';
  @IsString() @Matches(/^[a-z0-9.-]+$/) domainHostname!: string;
  @IsEmail() adminEmail!: string;
}

export class SetTierDto {
  @IsIn(['BASIC', 'STANDARD', 'PRO']) tier!: 'BASIC' | 'STANDARD' | 'PRO';
}

export class SetFeatureDto {
  @IsIn(['PUBLIC_SITE', 'GALLERY', 'ENQUIRY', 'SOCIAL', 'ABOUT_CONTACT', 'EVENTS', 'MANAGEMENT']) featureKey!: string;
  @IsBoolean() enabled!: boolean;
}

export class ModerateEventDto {
  @IsIn(['APPROVE', 'REJECT']) action!: 'APPROVE' | 'REJECT';
}

export class OwnerCreateEventDto {
  @IsUUID() schoolId!: string;
  @IsString() @Length(1, 160) title!: string;
  @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @IsDateString() startAt!: string;
  @IsOptional() @IsDateString() endAt?: string;
  @IsOptional() @IsString() @Length(0, 200) venue?: string;
}
