import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// ── Catalogue ─────────────────────────────────────────────

export class CreateTitleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  author!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  shelf?: string;
}

// ── Counter ───────────────────────────────────────────────

export class IssueDto {
  /** A specific physical copy… */
  @IsOptional()
  @IsUUID()
  copyId?: string;

  /** …or any free copy of a title. Exactly one of the two. */
  @IsOptional()
  @IsUUID()
  titleId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  teacherId?: string;

  /**
   * "Issue anyway" — the approved warn-don't-block: at-limit and
   * already-holds-this-title come back as 409s until the librarian
   * explicitly overrides.
   */
  @IsOptional()
  @IsBoolean()
  override?: boolean;
}

// ── Fines ─────────────────────────────────────────────────

export class RemindFinesDto {
  /** Remind every indebted reader in this class… */
  @IsOptional()
  @IsUUID()
  classSectionId?: string;

  /** …or every indebted teacher (only meaningful while fineTeachers is on). */
  @IsOptional()
  @IsBoolean()
  staff?: boolean;
}

// ── Hall ──────────────────────────────────────────────────

export class HallMarkDto {
  @IsUUID()
  studentId!: string;

  @IsIn(['PRESENT', 'ABSENT', 'LATE'])
  status!: 'PRESENT' | 'ABSENT' | 'LATE';
}

export class SaveHallVisitDto {
  @IsUUID()
  classSectionId!: string;

  /** IST calendar date; defaults to today. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional()
  @IsUUID()
  periodId?: string;

  @IsIn(['SYNCED', 'RETAKEN'])
  source!: 'SYNCED' | 'RETAKEN';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HallMarkDto)
  marks!: HallMarkDto[];
}

// ── Settings ──────────────────────────────────────────────

export class UpdateLibrarySettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  hallCapacityClasses?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  studentLoanLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  teacherLoanLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  loanDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  finePerDayRupees?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  graceDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lostFeeRupees?: number;

  @IsOptional()
  @IsBoolean()
  fineTeachers?: boolean;

  @IsOptional()
  @IsBoolean()
  dueSoonReminders?: boolean;
}
