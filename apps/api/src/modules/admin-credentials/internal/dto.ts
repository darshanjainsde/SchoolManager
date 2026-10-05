import { IsOptional, IsString, Length, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

/**
 * Owner-side reset of a school admin's password. Leave `password` out to have
 * the server generate a strong one; send it to set one the owner chose (the
 * same 8-character floor every other password path in the product enforces).
 */
export class ResetAdminPasswordDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(8, 200)
  password?: string;
}
