import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Sessions / year end (Active Roster, Track C). Spec §4, §6. */

export class CreateSessionPlanDto {
  @IsString() @Length(1, 40) name!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
}

export class UpdateSessionPlanDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) passMarkPct?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true }) countExamIds?: string[];
  /** { [fromSectionId]: toSectionId | 'PASS_OUT' } */
  @IsOptional() @IsObject() sectionMap?: Record<string, string>;
  @IsOptional() @IsIn(['KEEP', 'ALPHABETICAL', 'ADMISSION_NO']) rollPolicy?: 'KEEP' | 'ALPHABETICAL' | 'ADMISSION_NO';
  @IsOptional() @IsBoolean() copyTimetable?: boolean;
  @IsOptional() @IsBoolean() carryLeave?: boolean;
}

export type SessionDecisionKindDto = 'PROMOTE' | 'STAY' | 'PASS_OUT' | 'LEAVE';

export class DecisionRowDto {
  @IsUUID() studentId!: string;
  @IsIn(['PROMOTE', 'STAY', 'PASS_OUT', 'LEAVE']) decision!: SessionDecisionKindDto;
  @IsOptional() @IsUUID() toSectionId?: string | null;
  @IsOptional() @IsIn(['TRANSFERRED', 'LEFT']) leaveStatus?: 'TRANSFERRED' | 'LEFT';
  @IsOptional() @IsString() @Length(0, 120) leaveReason?: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class PutDecisionsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => DecisionRowDto) rows!: DecisionRowDto[];
}

export class CapDueDatesDto {
  /** YYYY-MM-DD; every open student loan due after this day is brought forward to it. */
  @IsDateString() lastDueOn!: string;
}

export class StartSessionDto {
  @IsIn(['NOW', 'ON_START_DATE']) when!: 'NOW' | 'ON_START_DATE';
  /** The plan version the review was loaded with — a stale review may not start the session. */
  @IsInt() @Min(1) version!: number;
}

/** One child in the Decide step (spec §4.3). Percentages are computed on read, never stored. */
export interface SessionStudentRow {
  studentId: string;
  rollNo: string | null;
  name: string;
  admissionNo: string;
  attendancePct: number | null;
  resultsPct: number | null;
  /** Below the pass mark — a flag for the office, never a decision (D10). */
  review: boolean;
  /** Admitted after the plan was opened: probably already seated for the new year. */
  joinedSincePlan: boolean;
  decision: SessionDecisionKindDto | null;
  toSectionId: string | null;
  leaveStatus: 'TRANSFERRED' | 'LEFT' | null;
  leaveReason: string | null;
  note: string | null;
  /** What "Promote" means for this class by the section map: PASS_OUT for the top grade. */
  defaultDecision: 'PROMOTE' | 'PASS_OUT';
  /** The same grade next year, for "Stay in grade". */
  stayToSectionId: string | null;
}
