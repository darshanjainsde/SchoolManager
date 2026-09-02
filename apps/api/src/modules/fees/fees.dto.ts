import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const FEE_FREQUENCIES = ['PER_TERM', 'ANNUAL', 'ONE_TIME'] as const;
export type FeeFrequencyValue = (typeof FEE_FREQUENCIES)[number];

export const FEE_PAYMENT_METHODS = [
  'UPI', 'NEFT_IMPS', 'CHEQUE', 'CASH', 'CARD', 'NETBANKING', 'OTHER',
] as const;
export type FeePaymentMethodValue = (typeof FEE_PAYMENT_METHODS)[number];

/**
 * The reasons a claim can be turned down. A closed list rather than free text
 * because the reason is shown to the parent verbatim and has to tell them what
 * to do next — "unclear" is not an instruction.
 */
export const REJECTION_REASONS = [
  'We could not read the screenshot — please send a clearer one.',
  'The amount does not match what is due. Please check and send again.',
  'We could not find this reference in our bank account.',
  'This payment has already been recorded.',
  'The payment details are incomplete.',
] as const;

// ── Setup ────────────────────────────────────────────────────────────────────

export class SaveCategoryDto {
  @IsOptional() @IsUUID() id?: string;

  @IsString() @Length(1, 60) name!: string;

  /**
   * Required, deliberately: this is what a parent reads under the amount on
   * their bill, and it is the whole transparency mechanism. A category with no
   * explanation is a category that generates a phone call.
   */
  @IsString() @Length(1, 200) description!: string;

  @IsIn(FEE_FREQUENCIES) frequency!: FeeFrequencyValue;
  @IsBoolean() isOptional!: boolean;
  @IsBoolean() isCollectible!: boolean;
  @IsInt() @Min(0) @Max(999) order!: number;
}

export class TermDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @Length(1, 40) name!: string;
  @IsDateString() dueDate!: string;
}

export class SaveTermsDto {
  @IsUUID() academicYearId!: string;

  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => TermDto)
  terms!: TermDto[];
}

export class GridCellDto {
  @IsUUID() gradeId!: string;
  @IsUUID() categoryId!: string;
  /** Null = the same amount in every term, which is the normal case. */
  @IsOptional() @IsUUID() termId?: string | null;
  @IsInt() @Min(0) @Max(100_000_000) amountMinor!: number;
}

export class SaveGridDto {
  @IsUUID() academicYearId!: string;

  // A 30-grade × 15-category × 4-term school is 1,800 cells; 8,000 is generous
  // headroom and still bounds the request.
  @IsArray() @ArrayMaxSize(8000) @ValidateNested({ each: true }) @Type(() => GridCellDto)
  cells!: GridCellDto[];
}

export const LATE_FEE_MODES = ['NONE', 'FLAT', 'PER_DAY'] as const;
export type LateFeeModeValue = (typeof LATE_FEE_MODES)[number];

export class SaveSettingsDto {
  @IsIn(LATE_FEE_MODES) lateFeeMode!: LateFeeModeValue;

  /** Paise. The whole fee for FLAT, the daily rate for PER_DAY. */
  @IsInt() @Min(0) @Max(10_000_000) lateFeeAmountMinor!: number;

  @IsInt() @Min(0) @Max(365) lateFeeGraceDays!: number;

  /** 0 means uncapped. */
  @IsInt() @Min(0) @Max(100_000_000) lateFeeCapMinor!: number;
}

export class SaveConcessionDto {
  @IsUUID() studentId!: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() termId?: string;

  /** Basis points — 1000 is 10%. Exactly one of these two is set. */
  @IsOptional() @IsInt() @Min(1) @Max(10_000) percentBps?: number;
  @IsOptional() @IsInt() @Min(1) amountMinor?: number;

  @IsString() @Length(3, 120) reason!: string;
}

// ── Payments ─────────────────────────────────────────────────────────────────

/**
 * Submitted as MULTIPART, because the screenshot rides along with the claim —
 * which means every field arrives as a STRING. `@Type(() => Number)` is what
 * makes `@IsInt()` see a number rather than "810000"; without it the whole
 * form is rejected, and the parent has no way to tell why.
 */
export class SubmitPaymentDto {
  @IsUUID() studentId!: string;
  @IsOptional() @IsUUID() invoiceId?: string;

  @IsIn(FEE_PAYMENT_METHODS) method!: FeePaymentMethodValue;

  @Type(() => Number) @IsInt() @Min(1) @Max(100_000_000) amountMinor!: number;

  @IsDateString() paidOn!: string;

  /** UTR / UPI reference. Optional because cash has none. */
  @IsOptional() @IsString() @Length(3, 64) reference?: string;

  @IsOptional() @IsString() @Length(0, 300) note?: string;
}

export class RejectPaymentDto {
  @IsString() @Length(3, 300) reason!: string;
}

export class ReversePaymentDto {
  @IsString() @Length(3, 300) reason!: string;
}

// ── Payment setup ────────────────────────────────────────────────────────────

export class SaveBankDetailDto {
  @IsString() @Length(2, 120) accountName!: string;
  @IsString() @Length(4, 30) accountNumber!: string;
  @IsString() @Length(11, 11) ifsc!: string;
  @IsString() @Length(2, 80) bankName!: string;
  @IsOptional() @IsString() @Length(0, 80) branch?: string;
  @IsOptional() @IsString() @Length(0, 80) upiId?: string;
  @IsOptional() @IsString() @Length(0, 300) instructions?: string;
  @IsBoolean() isVisible!: boolean;
}

export class SaveProviderConfigDto {
  @IsString() @Length(2, 30) provider!: string;
  @IsBoolean() enabled!: boolean;

  /**
   * The provider's own declared fields. Validated against `configFields` in
   * the service rather than here, because the shape is per provider and only
   * the provider knows it — which is what makes adding one a single file.
   */
  @IsOptional() config?: Record<string, string>;
  @IsOptional() secrets?: Record<string, string>;
}
