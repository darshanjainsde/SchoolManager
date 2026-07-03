import { IsEmail, IsIn, IsString, Length, Matches } from 'class-validator';

export class OwnerLoginDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 200) password!: string;
  @Matches(/^\d{6}$/) totp!: string;
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
