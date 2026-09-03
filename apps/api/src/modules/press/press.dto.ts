import {
  ValidateIf,
  ValidateNested,
  IsInt,
  Min,
  Max,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PRESS_DOC_TYPES, STUDENT_CATEGORIES } from '@skoolos/types';

/** Certificate types only — a report card is issued through its own batch route. */
export const PRESS_CERTIFICATE_TYPES = PRESS_DOC_TYPES.filter((t) => t !== 'REPORT_CARD');

export class SaveWindowDto {
  @IsOptional() @IsUUID() id?: string;

  @IsUUID() academicYearId!: string;

  /** "Term I", "Half-Yearly" — what prints on every card in the batch. */
  @IsString() @Length(1, 40) name!: string;

  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;

  /** Result day — when scores are due and cards go out. '' clears it. */
  @IsOptional() @ValidateIf((o) => o.resultDay !== '') @IsDateString() resultDay?: string;
}

class CoScholasticDto {
  @IsString() @Length(1, 40) label!: string;
  @IsIn(['A', 'B', 'C']) grade!: 'A' | 'B' | 'C';
}

export class RemarkExtrasDto {
  @IsOptional() @IsString() @Length(1, 40) house?: string;
  @IsOptional() @IsInt() @Min(50) @Max(230) heightCm?: number;
  @IsOptional() @IsInt() @Min(10) @Max(180) weightKg?: number;
  @IsOptional() @IsString() @Length(1, 120) promotion?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => CoScholasticDto)
  coScholastic?: CoScholasticDto[];
}

export class SaveRemarkDto {
  @IsUUID() windowId!: string;
  @IsUUID() studentId!: string;

  /**
   * 400 characters — about four sentences. The cap is the card's, not the
   * database's: a remark longer than its printed box silently truncates on
   * paper, which is worse than a validation message on screen.
   */
  @IsString() @Length(0, 400) text!: string;

  /** The card's optional blocks — validated shape, stored as printed. */
  @IsOptional() @ValidateNested() @Type(() => RemarkExtrasDto)
  extras?: RemarkExtrasDto;
}

export class NudgeResultsDto {
  @IsUUID() windowId!: string;
  @IsUUID() classSectionId!: string;
  @IsUUID() subjectId!: string;
  @IsIn(['ENTER', 'PUBLISH']) kind!: 'ENTER' | 'PUBLISH';
}

export class GenerateClassDto {
  @IsUUID() windowId!: string;
  @IsUUID() classSectionId!: string;

  /** Required to say something when the class is NOT ready — audited. */
  @IsOptional() @IsString() @Length(5, 300) overrideNote?: string;
}

export class IssueReportCardsDto {
  @IsUUID() windowId!: string;
  @IsUUID() classSectionId!: string;

  /** Omitted = the whole class. Capped at a class-sized batch. */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true })
  studentIds?: string[];
}

export class VoidIssueDto {
  /**
   * Required, and required to say something: "wrong marks — reissued after
   * correction" is what an inspector reads next to a struck-through entry.
   */
  @IsString() @Length(3, 300) note!: string;
}

export class IssueCertificateDto {
  @IsUUID() studentId!: string;

  @IsIn(PRESS_CERTIFICATE_TYPES) type!: string;

  /**
   * TC only: issue over an outstanding fee balance. Recorded in the snapshot —
   * the register remembers the balance AND that somebody chose to look past it.
   */
  @IsOptional() @IsBoolean() duesOverride?: boolean;

  // Wording, all optional — the service fills defaults and snapshots the result.
  @IsOptional() @IsString() @Length(1, 60) conduct?: string;
  @IsOptional() @IsString() @Length(1, 200) reason?: string;
  @IsOptional() @IsDateString() fromDate?: string;
  @IsOptional() @IsDateString() toDate?: string;
  @IsOptional() @IsString() @Length(1, 60) classLabel?: string;
  @IsOptional() @IsString() @Length(1, 200) purpose?: string;
  @IsOptional() @IsString() @Length(1, 300) note?: string;

  // ── Annexure-I statutory answers (TC) — free text, printed verbatim. ──
  @IsOptional() @IsString() @Length(1, 120) examLastTaken?: string;
  @IsOptional() @IsString() @Length(1, 60) failedBefore?: string;
  @IsOptional() @IsString() @Length(1, 200) subjects?: string;
  @IsOptional() @IsString() @Length(1, 60) qualifiedForPromotion?: string;
  @IsOptional() @IsString() @Length(1, 40) promotedToClass?: string;
  @IsOptional() @IsString() @Length(1, 40) feesPaidUpto?: string;
  @IsOptional() @IsString() @Length(1, 120) feeConcession?: string;
  @IsOptional() @IsString() @Length(1, 12) workingDays?: string;
  @IsOptional() @IsString() @Length(1, 12) presentDays?: string;
  @IsOptional() @IsString() @Length(1, 120) nccScout?: string;
  @IsOptional() @IsString() @Length(1, 160) games?: string;
  @IsOptional() @IsDateString() dateOfApplication?: string;
  /** CISCE variant: the Council's Index Number + year of passing. */
  @IsOptional() @IsString() @Length(1, 40) indexNo?: string;
  @IsOptional() @IsString() @Length(1, 10) yearOfPassing?: string;

  // ── File facts, saved back to the Student row on issue (typed once, ever). ──
  @IsOptional() @IsString() @Length(1, 120) fatherName?: string;
  @IsOptional() @IsString() @Length(1, 120) motherName?: string;
  @IsOptional() @IsString() @Length(1, 60) nationality?: string;
  @IsOptional() @IsIn(STUDENT_CATEGORIES) category?: string;
  @IsOptional() @IsDateString() firstAdmissionDate?: string;
  @IsOptional() @IsString() @Length(1, 40) firstAdmissionClass?: string;
  @IsOptional() @IsString() @Length(1, 160) previousSchool?: string;
  @IsOptional() @IsString() @Length(1, 40) penId?: string;
}

/**
 * One class, one type, one run — the whole passing-out class's TCs, the
 * scholarship season's bonafides. Per-child data prints from the file;
 * the run never invents an answer.
 */
export class BulkCertificatesDto {
  @IsIn(PRESS_CERTIFICATE_TYPES) type!: string;

  @IsUUID() classSectionId!: string;

  /** Omitted = every active student in the class. */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true })
  studentIds?: string[];

  /** TC only: issue over outstanding balances — recorded per snapshot. */
  @IsOptional() @IsBoolean() duesOverride?: boolean;

  // Common wording for the whole run, all optional.
  @IsOptional() @IsString() @Length(1, 60) conduct?: string;
  @IsOptional() @IsString() @Length(1, 200) reason?: string;
  @IsOptional() @IsString() @Length(1, 200) purpose?: string;
  @IsOptional() @IsString() @Length(1, 300) note?: string;
}
