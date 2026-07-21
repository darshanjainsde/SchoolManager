import { IsEmail, IsOptional, IsString, Length, MinLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  /**
   * Either an email address or a student admission number. `email` is kept as
   * an optional alias so existing `{ email, password }` callers keep working.
   */
  @ApiPropertyOptional()
  @ValidateIf((dto: LoginDto) => !dto.email)
  @IsString()
  @MinLength(1)
  identifier?: string;

  @ApiPropertyOptional()
  @ValidateIf((dto: LoginDto) => !dto.identifier)
  @IsEmail()
  email?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @Length(32, 64)
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class ImpersonateDto {
  @ApiProperty()
  @IsString()
  @Length(24, 64)
  token!: string;
}
