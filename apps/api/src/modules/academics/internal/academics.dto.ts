import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class CreateGradeDto {
  @ApiProperty() @IsString() @Length(1, 40) name!: string;
  @ApiProperty() @IsInt() @Min(0) sequence!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateGradeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sequence?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateClassDto {
  @ApiProperty() @IsUUID() gradeId!: string;
  @ApiProperty() @IsUUID() academicYearId!: string;
  @ApiProperty() @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() classTeacherUserId?: string;
}
export class UpdateClassDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() classTeacherUserId?: string;
}

export class CreateSectionDto {
  @ApiProperty() @IsUUID() classId!: string;
  @ApiProperty() @IsString() @Length(1, 40) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) capacity?: number;
}
export class UpdateSectionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) capacity?: number;
}

export class CreateSubjectDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[A-Z0-9-]{2,16}$/, { message: 'code must be uppercase letters/digits/dashes' })
  code!: string;
  @ApiProperty() @IsString() @Length(1, 80) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isElective?: boolean;
}
export class UpdateSubjectDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isElective?: boolean;
}

export class CreateEnrollmentDto {
  @ApiProperty() @IsUUID() studentUserId!: string;
  @ApiProperty() @IsUUID() classId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiProperty() @IsUUID() academicYearId!: string;
}
export class TransitionEnrollmentDto {
  @ApiProperty({ enum: ['TRANSFERRED', 'GRADUATED', 'WITHDRAWN'] })
  @IsEnum(['TRANSFERRED', 'GRADUATED', 'WITHDRAWN'])
  status!: 'TRANSFERRED' | 'GRADUATED' | 'WITHDRAWN';
}
