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
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ASSIGNMENT_ATTACHMENT_KINDS,
  AssignmentAttachmentKind,
  ATTENDANCE_STATUSES,
  AttendanceStatusValue,
  CLASS_NOTE_VISIBILITIES,
  ClassNoteVisibilityValue,
  DIARY_AUDIENCES,
  DIARY_ENTRY_KINDS,
  DiaryAudience,
  DiaryEntryKind,
  HOLIDAY_TYPES,
  HolidayType,
} from '@skoolos/types';

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

/**
 * Mirrors the `StaffRole` enum in schema.prisma. LIBRARIAN is the one value
 * that also decides a DOOR: a staff member with that job signs in as ordinary
 * STAFF and lands on /library (homeForRole reads `staffRole` from /auth/me).
 * The login role stays STAFF — the job title, not the account type, is what
 * makes a librarian.
 */
const STAFF_ROLES = ['OFFICE', 'SUPPORT', 'DRIVER', 'HELPER', 'SECURITY', 'LIBRARIAN', 'OTHER'] as const;
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

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be formatted as YYYY-MM-DD' })
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

// ── Leave policy (types, allocations, carry-forward) ─────────────────────────

export class CreateLeaveTypeDefDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(366)
  defaultAnnual?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(366)
  carryForwardCap?: number;
}

export class UpdateLeaveTypeDefDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(366)
  defaultAnnual?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(366)
  carryForwardCap?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetLeaveAllocationDto {
  @IsUUID()
  teacherId!: string;

  @IsUUID()
  typeDefId!: string;

  @IsUUID()
  academicYearId!: string;

  @IsInt()
  @Min(0)
  @Max(366)
  allotted!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(366)
  carriedIn?: number;
}

export class ApplyLeaveDefaultsDto {
  @IsOptional()
  @IsUUID()
  academicYearId?: string;
}

export class CloseLeaveYearDto {
  @IsUUID()
  fromAcademicYearId!: string;

  @IsUUID()
  toAcademicYearId!: string;
}

// ── Holidays ─────────────────────────────────────────────────────────────────
// HOLIDAY_TYPES/HolidayType come from @skoolos/types — the same union the
// web/mobile Holiday screens render against, so a new type can't be added on
// one side without the other noticing.

export class CreateHolidayDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsIn([...HOLIDAY_TYPES])
  type!: HolidayType;

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

  @IsUUID()
  subjectId!: string;

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

// ── Class note visibility (school setting) ───────────────────────────────────

export class UpdateClassNoteVisibilityDto {
  @IsIn(CLASS_NOTE_VISIBILITIES)
  classNoteVisibility!: ClassNoteVisibilityValue;
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

// ── Assignments (T21) ────────────────────────────────────────────────────────

/**
 * One entry of `CreateAssignmentDto.attachments` — the exact shape
 * `POST /manage/assignments/upload` returns, round-tripped straight back
 * on create. `url` is `require_tld: false` so a local MinIO dev URL
 * (`http://localhost:9000/...`) validates the same as a production Supabase
 * Storage URL — this DTO validates SHAPE, not provenance; the value always
 * comes from our own upload endpoint's response, never typed by a caller.
 */
export class AssignmentAttachmentDto {
  @IsUrl({ require_tld: false })
  url!: string;

  @IsString()
  @Length(1, 255)
  name!: string;

  @IsIn([...ASSIGNMENT_ATTACHMENT_KINDS])
  kind!: AssignmentAttachmentKind;
}

export class CreateAssignmentDto {
  @IsUUID()
  classSectionId!: string;

  @IsUUID()
  subjectId!: string;

  @IsString()
  @Length(1, 160)
  title!: string;

  @IsString()
  @Length(1, 4000)
  instructions!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueDate must be formatted as YYYY-MM-DD' })
  dueDate!: string;

  /**
   * Optional — an assignment with plain-text instructions and no file is
   * legitimate. Capped at 5: enough for "the worksheet + an answer key
   * scan", not an open-ended file dump.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => AssignmentAttachmentDto)
  attachments?: AssignmentAttachmentDto[];
}

// ── The Daily Diary (Phase 5·3) ──────────────────────────────────────────────

export class CreateDiaryEntryDto {
  @IsUUID()
  classSectionId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be formatted as YYYY-MM-DD' })
  date!: string;

  @IsIn(DIARY_ENTRY_KINDS)
  kind!: DiaryEntryKind;

  /** Ignored for a REMARK, which is always SELECTED — see DiaryService.create. */
  @IsOptional()
  @IsIn(DIARY_AUDIENCES)
  audience?: DiaryAudience;

  @IsString()
  @Length(1, 2000)
  body!: string;

  @IsOptional()
  @IsUUID()
  subjectId?: string;

  /** The children named by the type-a-name picker. Capped well above any real
   *  class so a whole section can still be named one by one if a teacher wants. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID(undefined, { each: true })
  studentIds?: string[];
}

export class UpdateDiaryEntryDto {
  @IsString()
  @Length(1, 2000)
  body!: string;
}

// ── The attendance bar (Phase 5·3) ───────────────────────────────────────────

export class NotifyLowAttendanceDto {
  @IsUUID()
  classSectionId!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  threshold!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from must be formatted as YYYY-MM-DD' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to must be formatted as YYYY-MM-DD' })
  to!: string;

  /** The teacher's final say: exactly which families to tell. Omitted means
   *  every student under the threshold in the window. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  studentIds?: string[];
}

// ── School email identity (Letterhead) ───────────────────────────────────────

const EMAIL_TEMPLATE_VALUES = ['CLASSIC', 'BANNER', 'MINIMAL'] as const;

export class UpdateEmailSettingsDto {
  @IsOptional()
  @IsIn(EMAIL_TEMPLATE_VALUES)
  template?: (typeof EMAIL_TEMPLATE_VALUES)[number];

  /** Empty string clears the override and falls back to the school's name. */
  @IsOptional()
  @IsString()
  @Length(0, 80)
  senderName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 160)
  replyTo?: string;

  /** `#rrggbb`; normalised server-side so it can never inject CSS. */
  @IsOptional()
  @IsString()
  @Matches(/^$|^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/, { message: 'accentColor must be a hex colour' })
  accentColor?: string;

  @IsOptional()
  @IsString()
  logoAssetId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @Length(0, 160, { each: true })
  footerLines?: string[];
}

export class UpdateEmailSenderDto {
  @IsEmail()
  fromAddress!: string;

  @IsString()
  @Length(1, 200)
  smtpHost!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort!: number;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  smtpUser?: string;

  /** Write-only: never returned by any endpoint, encrypted before storage. */
  @IsOptional()
  @IsString()
  @Length(1, 400)
  smtpPass?: string;
}

export class VerifyEmailSenderDto {
  @IsEmail()
  to!: string;
}

export class SendTestEmailDto {
  @IsEmail()
  to!: string;
}

// ── Exam Hall ────────────────────────────────────────────────────────────────

/**
 * A room as the office drew it. `removedDesks` is the desk positions with no
 * desk — a pillar, a broken desk, a walking lane.
 *
 * The bounds here are the OUTER limit (a shape the seating screen could still
 * draw); the service re-checks them and also drops "row:col" entries that fall
 * outside the grid, which is what shrinking a room in the editor leaves behind.
 */
export class SaveRoomDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(20)
  rows!: number;

  @IsInt()
  @Min(1)
  @Max(30)
  cols!: number;

  /** 1 or 2. Two only where the desk is a bench. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  seatsPerDesk?: number;

  /** "row:col", 0-based. Capped at a full 20×30 grid. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(600)
  @IsString({ each: true })
  @Length(3, 11, { each: true })
  removedDesks?: string[];
}

export class SeatingRulesDto {
  @IsOptional()
  @IsBoolean()
  noClassmates?: boolean;

  @IsOptional()
  @IsBoolean()
  alternateCols?: boolean;

  @IsOptional()
  @IsBoolean()
  spreadRolls?: boolean;

  @IsOptional()
  @IsBoolean()
  backRowFree?: boolean;
}

export class PreviewSeatingDto {
  @IsUUID()
  roomId!: string;

  /** Sections to seat, in the order the office ticked them. */
  @IsArray()
  @ArrayMaxSize(24)
  @IsUUID('4', { each: true })
  classSectionIds!: string[];

  @IsOptional()
  @IsString()
  @Length(0, 120)
  title?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SeatingRulesDto)
  rules?: SeatingRulesDto;

  /**
   * The generator is seeded, so the same seed rebuilds the same hall. The
   * office sends a new one to reshuffle after a chart leaks.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9972)
  seed?: number;
}

export class SaveSeatingDto extends PreviewSeatingDto {}
