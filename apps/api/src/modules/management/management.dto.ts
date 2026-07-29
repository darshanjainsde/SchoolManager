import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ATTENDANCE_STATUSES, AttendanceStatusValue } from '@skoolos/types';

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

  /** Defaults to CLASS at the DB layer; a BREAK period is how lunch/recess is modeled. */
  @IsOptional()
  @IsIn(['CLASS', 'BREAK'])
  kind?: 'CLASS' | 'BREAK';
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

  @IsOptional()
  @IsIn(['CLASS', 'BREAK'])
  kind?: 'CLASS' | 'BREAK';
}

// ── Working days ─────────────────────────────────────────────────────────────

export class UpdateWorkingDaysDto {
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workingDays!: number[];
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

// ── Staff (non-teaching) ────────────────────────────────────────────────────

const STAFF_ROLES = ['OFFICE', 'SUPPORT', 'DRIVER', 'HELPER', 'SECURITY', 'OTHER'] as const;
export type StaffRoleValue = (typeof STAFF_ROLES)[number];

export class CreateStaffDto {
  @IsString()
  @Length(1, 120)
  firstName!: string;

  @IsString()
  @Length(1, 120)
  lastName!: string;

  @IsIn(STAFF_ROLES)
  role!: StaffRoleValue;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  firstName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  lastName?: string;

  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: StaffRoleValue;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

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

// ── Login invites (students + teachers) ──────────────────────────────────────

/**
 * `email` is intentionally optional here (not `@IsEmail() email!: string`):
 * the "required" business rule differs per caller (always required for
 * students; falls back to the existing Teacher.email for teachers) and the
 * service throws a typed `EMAIL_REQUIRED` ApiError rather than a generic
 * class-validator 400, so the check has to happen after this DTO parses.
 */
export class CreateLoginDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  username?: string;
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

// ── Availability ──────────────────────────────────────────────────────────────

export class AvailabilityQueryDto {
  @IsOptional()
  @IsUUID()
  academicYearId?: string;
}

// ── Announcement ─────────────────────────────────────────────────────────────

export class CreateAnnouncementDto {
  @IsString()
  @Length(1, 160)
  title!: string;

  @IsString()
  @Length(1, 4000)
  body!: string;

  /**
   * Legacy single-target field — still accepted so the existing web admin
   * "post to one class" flow keeps working unchanged. Omitted (together with
   * `classSectionIds`) = school-wide.
   */
  @IsOptional()
  @IsUUID()
  classSectionId?: string;

  /**
   * Multi-target field (teacher-authored announcements to several classes at
   * once). Merged with `classSectionId` by the service, not overridden by
   * it — a caller may send either or both.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('4', { each: true })
  classSectionIds?: string[];
}

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 4000)
  body?: string;

  @IsOptional()
  @IsUUID()
  classSectionId?: string;
}

// ── Attendance ───────────────────────────────────────────────────────────────

export class AttendanceMarkDto {
  @IsUUID()
  studentId!: string;

  // Status values are defined in @skoolos/types to ensure API, web, and mobile agree.
  @IsIn([...ATTENDANCE_STATUSES])
  status!: AttendanceStatusValue;
}

export class SaveAttendanceDto {
  @IsUUID()
  classSectionId!: string;

  @IsDateString()
  date!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttendanceMarkDto)
  marks!: AttendanceMarkDto[];
}

// ── Staff attendance (teachers + non-teaching staff) ─────────────────────────

export class StaffAttendanceMarkDto {
  @IsUUID()
  personId!: string;

  @IsIn(['TEACHER', 'STAFF'])
  kind!: 'TEACHER' | 'STAFF';

  @IsIn(['PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE'])
  status!: 'PRESENT' | 'ABSENT' | 'LATE' | 'ON_LEAVE';
}

export class SaveStaffAttendanceDto {
  @IsDateString()
  date!: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => StaffAttendanceMarkDto)
  marks!: StaffAttendanceMarkDto[];
}

// ── Exam / Results ───────────────────────────────────────────────────────────

export class CreateExamDto {
  @IsUUID()
  classSectionId!: string;

  @IsUUID()
  subjectId!: string;

  @IsString()
  @Length(1, 160)
  title!: string;

  @IsDateString()
  scheduledAt!: string;

  @IsOptional()
  @IsString()
  @Length(1, 4000)
  syllabus?: string;

  @IsInt()
  @Min(1)
  maxMarks!: number;
}

export class ExamResultMarkDto {
  @IsUUID()
  studentId!: string;

  @IsNumber()
  marks!: number;
}

export class SaveExamResultsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ExamResultMarkDto)
  marks!: ExamResultMarkDto[];
}

// ── Leave applications & substitution coverage ───────────────────────────────

const LEAVE_TYPES = ['SICK', 'CASUAL', 'EARNED', 'UNPAID', 'OTHER'] as const;
export type LeaveTypeValue = (typeof LEAVE_TYPES)[number];

export class CreateLeaveDto {
  @IsIn(LEAVE_TYPES)
  type!: LeaveTypeValue;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reason?: string;
}

export class AssignSubstitutionDto {
  @IsUUID()
  substituteTeacherId!: string;
}

// ── Holidays ─────────────────────────────────────────────────────────────────

export const HOLIDAY_TYPES = ['PUBLIC', 'FESTIVAL', 'SCHOOL'] as const;
export type HolidayTypeValue = (typeof HOLIDAY_TYPES)[number];

export class CreateHolidayDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsIn(HOLIDAY_TYPES)
  type!: HolidayTypeValue;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

// ── Class notes & to-dos ─────────────────────────────────────────────────────

export class CreateClassNoteDto {
  @IsUUID()
  classSectionId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be formatted as YYYY-MM-DD' })
  date!: string;

  @IsString()
  @Length(1, 1000)
  body!: string;
}

export class CreateClassTodoDto extends CreateClassNoteDto {}

export class UpdateClassTodoDto {
  @IsBoolean()
  done!: boolean;
}

// ── Register change requests ─────────────────────────────────────────────────

export class CreateRegisterChangeDto {
  @IsUUID()
  classSectionId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be formatted as YYYY-MM-DD' })
  date!: string;

  @IsString()
  @Length(1, 500)
  reason!: string;
}
