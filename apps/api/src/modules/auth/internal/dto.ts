import { IsEmail, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  /**
   * Either an email address or a student admission number. `email` is kept as
   * an optional alias so existing `{ email, password }` callers keep working.
   *
   * NOTE: `identifier` and `email` are validated independently (each is
   * type-checked whenever present, regardless of whether the other field is
   * also present). Do NOT reintroduce a mutual `@ValidateIf((dto) =>
   * !dto.other)` pattern here — when both fields are truthy, both predicates
   * evaluate false and NEITHER field gets type-checked, letting a
   * non-string value (e.g. `identifier: 123`) slip through validation and
   * crash `AuthService.login` with an uncaught TypeError (500) instead of a
   * clean 400. The "at least one of identifier/email must be present" rule
   * is instead enforced by the `identifierOrEmail` getter below, which is
   * never skipped by `@IsOptional()`.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  identifier?: string;

  /**
   * `@IsEmail()` is intentionally NOT used: the admission-flow may reuse this
   * field for a non-RFC-strict value, so a plain string check is sufficient.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;

  /**
   * Virtual field (not sent by clients) that enforces "at least one of
   * identifier/email must be provided". It is intentionally NOT wrapped in
   * `@IsOptional()` so it is always validated, even when both `identifier`
   * and `email` are absent/undefined.
   */
  @IsString()
  @MinLength(1, { message: 'Either identifier or email must be provided' })
  get identifierOrEmail(): string {
    return this.identifier ?? this.email ?? '';
  }
}

export class RefreshDto {
  /** Optional: the token normally arrives as an HttpOnly cookie. The body form
   *  is kept so sessions created before the cookie shipped can still refresh. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refreshToken?: string;
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

/** Phase 5·1 — password reset with only the RAF-00042 student code. */
export class ResetByCodeDto {
  @ApiProperty({ example: 'RAF-00042' })
  @IsString()
  @Matches(/^[A-Za-z]{3}-\d{4,}$/, { message: 'The code looks like AAA-00001 — three letters, then digits' })
  code!: string;
}

/**
 * App entry gate — resolve a login identifier (student code or email) to the
 * school host(s) it could belong to, before any tenant context exists.
 */
export class ResolveSchoolDto {
  @ApiProperty({ example: 'RAF-00042' })
  @IsString()
  @Length(3, 160)
  identifier!: string;
}
