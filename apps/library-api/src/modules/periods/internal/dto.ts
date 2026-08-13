import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePeriodDto {
  @IsUUID('4') branchId!: string;
  /** ISO weekday: 1 = Monday .. 7 = Sunday, so ordering and arithmetic behave. */
  @Type(() => Number) @IsInt() @Min(1) @Max(7) weekday!: number;
  /** The school's own period number — schools move bells, so this is not a clock time. */
  @Type(() => Number) @IsInt() @Min(1) @Max(20) period!: number;
  @IsString() @MinLength(1) @MaxLength(40) classRef!: string;
}

export class ListPeriodsQueryDto {
  @IsOptional() @IsUUID('4') branchId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(7) weekday?: number;
}

export class OpenVisitDto {
  @IsUUID('4') branchId!: string;
  @IsString() @MinLength(1) @MaxLength(40) classRef!: string;
  @IsOptional() @IsUUID('4') periodId?: string;
}

export class MarkAttendanceDto {
  @IsUUID('4') memberId!: string;
  /** Absent means "untick" — a librarian correcting a mis-tap must be able to undo it. */
  @IsOptional() @IsBoolean() present?: boolean;
}

export class ListVisitsQueryDto {
  @IsOptional() @IsUUID('4') branchId?: string;
  @IsOptional() @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' }) date?: string;
}

export class UpdateSettingsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) concurrentClassCapacity?: number;
  @IsOptional() @IsBoolean() recordAttendance?: boolean;
  @IsOptional() @IsBoolean() chargeStudentFines?: boolean;
}
