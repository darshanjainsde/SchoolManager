import { IsEmail, IsString, Length, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PlatformLoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  password!: string;

  /** 6-digit TOTP code — mandatory, no fallback. */
  @ApiProperty()
  @IsString()
  @Length(6, 6)
  totp!: string;
}

export class PlatformRefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}
