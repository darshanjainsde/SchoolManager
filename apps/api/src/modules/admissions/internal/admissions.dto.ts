import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';

export class CreateLeadDto {
  @ApiProperty() @IsString() @Length(2, 200) fullName!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() contactEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gradeAppliedFor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() source?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class UpdateLeadDto {
  @ApiPropertyOptional() @IsOptional() @IsString() fullName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() contactEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() gradeAppliedFor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assignedToUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() nextActionAt?: string;
}

export class StageDto {
  @ApiProperty({ enum: ['NEW', 'CONTACTED', 'TOUR_BOOKED', 'APPLIED', 'ENROLLED', 'LOST'] })
  @IsEnum(['NEW', 'CONTACTED', 'TOUR_BOOKED', 'APPLIED', 'ENROLLED', 'LOST'])
  stage!: 'NEW' | 'CONTACTED' | 'TOUR_BOOKED' | 'APPLIED' | 'ENROLLED' | 'LOST';
}

export class ConvertDto {
  @ApiProperty() @IsObject() applicantData!: Record<string, unknown>;
}

export class DecisionDto {
  @ApiProperty({ enum: ['UNDER_REVIEW', 'OFFERED', 'ACCEPTED', 'REJECTED', 'WAITLISTED'] })
  @IsEnum(['UNDER_REVIEW', 'OFFERED', 'ACCEPTED', 'REJECTED', 'WAITLISTED'])
  status!: 'UNDER_REVIEW' | 'OFFERED' | 'ACCEPTED' | 'REJECTED' | 'WAITLISTED';

  // For ACCEPTED status, the admin can pre-pick a class so the auto-enrollment works.
  @ApiPropertyOptional() @IsOptional() @IsUUID() classId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() academicYearId?: string;
}
