import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// ── Assignments ────────────────────────────────────────────────────────────
export class CreateAssignmentDto {
  @ApiProperty() @IsUUID() classId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiProperty() @IsUUID() subjectId!: string;
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty() @IsDateString() dueAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() attachmentUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) maxPoints?: number;
}

export class UpdateAssignmentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() attachmentUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) maxPoints?: number;
}

export class SubmitDto {
  @ApiPropertyOptional() @IsOptional() @IsString() body?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() attachmentUrl?: string;
}

export class GradeSubmissionDto {
  @ApiProperty() @IsNumber() @Min(0) grade!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() feedback?: string;
}

// ── Exams ──────────────────────────────────────────────────────────────────
export class CreateExamDto {
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiProperty() @IsUUID() classId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sectionId?: string;
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsDateString() endsAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() gradingSchemeId?: string;
}

export class ExamSubjectInputDto {
  @ApiProperty() @IsUUID() subjectId!: string;
  @ApiProperty() @IsInt() @Min(1) maxMarks!: number;
  @ApiProperty() @IsInt() @Min(0) passingMarks!: number;
}

export class SetExamSubjectsDto {
  @ApiProperty({ type: [ExamSubjectInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ExamSubjectInputDto)
  subjects!: ExamSubjectInputDto[];
}

export class MarkInputDto {
  @ApiProperty() @IsUUID() studentUserId!: string;
  @ApiProperty() @IsNumber() @Min(0) marksObtained!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAbsent?: boolean;
}

export class SaveMarksDto {
  @ApiProperty() @IsUUID() examSubjectId!: string;
  @ApiProperty({ type: [MarkInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MarkInputDto)
  marks!: MarkInputDto[];
}

// ── Grading scheme ─────────────────────────────────────────────────────────
export class GradingBandDto {
  @ApiProperty() @IsInt() @Min(0) @Max(100) min!: number;
  @ApiProperty() @IsString() @Length(1, 4) letter!: string;
}

export class CreateGradingSchemeDto {
  @ApiProperty() @IsString() @Length(1, 80) name!: string;
  @ApiProperty({ type: [GradingBandDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GradingBandDto)
  bands!: GradingBandDto[];
}
