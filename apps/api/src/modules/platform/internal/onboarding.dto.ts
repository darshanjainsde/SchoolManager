import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

class BrandColorsDto {
  @ApiProperty()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  primary!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  accent?: string;
}

class AddressDto {
  @ApiPropertyOptional() @IsOptional() @IsString() line1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() line2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() region?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsLongitude() lng?: number;
}

class AcademicYearDto {
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsString() startDate!: string;
  @ApiProperty() @IsString() endDate!: string;
}

class CsvUserDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() firstName!: string;
  @ApiProperty() @IsString() lastName!: string;
}

class CustomDomainDto {
  @ApiProperty()
  @IsString()
  @Matches(/^([a-z0-9-]+\.)+[a-z]{2,}$/i, { message: 'hostname must be a valid FQDN' })
  hostname!: string;

  @ApiProperty({ enum: ['APEX', 'SUBDOMAIN'] })
  @IsEnum(['APEX', 'SUBDOMAIN'])
  type!: 'APEX' | 'SUBDOMAIN';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class OnboardSchoolDto {
  // ── identity / branding ──
  @ApiProperty() @IsString() @Length(2, 80) name!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/, {
    message: 'slug must be 2-32 chars, lowercase letters/digits/dashes',
  })
  slug!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() logoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() faviconUrl?: string;

  @ApiPropertyOptional({ type: BrandColorsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandColorsDto)
  brandColors?: BrandColorsDto;

  @ApiPropertyOptional() @IsOptional() @IsString() aboutPage?: string;

  // ── contact / locale ──
  @ApiPropertyOptional({ type: AddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() timezone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() locale?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;

  // ── plan ──
  @ApiPropertyOptional({ enum: ['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'] })
  @IsOptional()
  @IsEnum(['TRIAL', 'STARTER', 'PRO', 'ENTERPRISE'])
  subscriptionPlan?: 'TRIAL' | 'STARTER' | 'PRO' | 'ENTERPRISE';

  // ── school-admin invite ──
  @ApiProperty() @IsEmail() adminEmail!: string;
  @ApiProperty() @IsString() adminFirstName!: string;
  @ApiProperty() @IsString() adminLastName!: string;

  // ── academic year (optional; default current calendar year if omitted) ──
  @ApiPropertyOptional({ type: AcademicYearDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AcademicYearDto)
  academicYear?: AcademicYearDto;

  // ── optional custom domain ──
  @ApiPropertyOptional({ type: CustomDomainDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomDomainDto)
  customDomain?: CustomDomainDto;

  // ── optional bulk staff/student import (pre-validated; backend re-validates) ──
  @ApiPropertyOptional({ type: [CsvUserDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CsvUserDto)
  initialTeachers?: CsvUserDto[];

  @ApiPropertyOptional({ type: [CsvUserDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CsvUserDto)
  initialStudents?: CsvUserDto[];
}
