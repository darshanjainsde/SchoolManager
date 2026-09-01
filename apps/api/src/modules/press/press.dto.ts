import {
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
import { PRESS_DOC_TYPES } from '@skoolos/types';

/** Certificate types only — a report card is issued through its own batch route. */
export const PRESS_CERTIFICATE_TYPES = PRESS_DOC_TYPES.filter((t) => t !== 'REPORT_CARD');

export class SaveWindowDto {
  @IsOptional() @IsUUID() id?: string;

  @IsUUID() academicYearId!: string;

  /** "Term I", "Half-Yearly" — what prints on every card in the batch. */
  @IsString() @Length(1, 40) name!: string;

  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
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
}

export class IssueReportCardsDto {
  @IsUUID() windowId!: string;
  @IsUUID() classSectionId!: string;

  /** Omitted = the whole class. Capped at a class-sized batch. */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true })
  studentIds?: string[];
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
}
