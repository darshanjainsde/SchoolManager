import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

// ── Academic Year ────────────────────────────────────────────────────────────

export class CreateYearDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}

// ── Grade ────────────────────────────────────────────────────────────────────

export class CreateGradeDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsInt()
  @Min(0)
  order!: number;
}

export class UpdateGradeDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

// ── Subject ──────────────────────────────────────────────────────────────────

export class CreateSubjectDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(1, 20)
  code!: string;
}

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  code?: string;
}

// ── Period ───────────────────────────────────────────────────────────────────

export class CreatePeriodDto {
  @IsInt()
  @Min(1)
  order!: number;

  @IsString()
  @Length(1, 60)
  label!: string;

  @IsString()
  @Length(1, 10)
  startTime!: string;

  @IsString()
  @Length(1, 10)
  endTime!: string;
}

export class UpdatePeriodDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  order?: number;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  label?: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  startTime?: string;

  @IsOptional()
  @IsString()
  @Length(1, 10)
  endTime?: string;
}

// ── Teacher ──────────────────────────────────────────────────────────────────

export class CreateTeacherDto {
  @IsString()
  @Length(1, 120)
  firstName!: string;

  @IsString()
  @Length(1, 120)
  lastName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsUUID()
  photoAssetId?: string;

  @IsOptional()
  @IsUUID()
  primarySubjectId?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTeacherDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsUUID()
  photoAssetId?: string;

  @IsOptional()
  @IsUUID()
  primarySubjectId?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── ClassSection ─────────────────────────────────────────────────────────────

export class CreateClassDto {
  @IsUUID()
  gradeId!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsUUID()
  academicYearId!: string;

  @IsOptional()
  @IsUUID()
  classTeacherId?: string;
}

export class UpdateClassDto {
  @IsOptional()
  @IsUUID()
  gradeId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsOptional()
  @IsUUID()
  classTeacherId?: string;
}

// ── Student ──────────────────────────────────────────────────────────────────

export class CreateStudentDto {
  @IsString()
  @Length(1, 60)
  admissionNo!: string;

  @IsString()
  @Length(1, 120)
  firstName!: string;

  @IsString()
  @Length(1, 120)
  lastName!: string;

  @IsOptional()
  @IsUUID()
  classSectionId?: string;

  @IsOptional()
  @IsString()
  rollNo?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @IsOptional()
  @IsString()
  guardianPhone?: string;

  @IsOptional()
  @IsUUID()
  photoAssetId?: string;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  admissionNo?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  lastName?: string;

  @IsOptional()
  @IsUUID()
  classSectionId?: string;

  @IsOptional()
  @IsString()
  rollNo?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @IsOptional()
  @IsString()
  guardianPhone?: string;

  @IsOptional()
  @IsUUID()
  photoAssetId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── TimetableSlot ─────────────────────────────────────────────────────────────

export class AssignSlotDto {
  @IsUUID()
  classSectionId!: string;

  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek!: number;

  @IsUUID()
  periodId!: string;

  @IsUUID()
  subjectId!: string;

  @IsUUID()
  teacherId!: string;

  @IsUUID()
  academicYearId!: string;
}
