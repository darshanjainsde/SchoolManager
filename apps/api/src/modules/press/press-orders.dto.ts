import {
  IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Press Orders — what the school may ask for and what the operator may
 * promise. Spec fields are closed IsIn unions (the TEXT-not-enum decision
 * lives in @skoolos/types; the DTO is the write-time guard).
 */

const SIZES = ['A4', 'A5', 'A3', 'CR80'] as const;
const COLOURS = ['COLOUR', 'BW'] as const;
const SIDES = ['SINGLE', 'DOUBLE'] as const;
const FINISHES = ['NONE', 'STAPLE', 'SPIRAL', 'SADDLE', 'LAMINATE'] as const;

class SpecDtoBase {
  @IsIn(SIZES) size!: string;
  @IsIn(COLOURS) colour!: string;
  @IsIn(SIDES) sides!: string;

  /** Paper weight. 60 gsm is newsprint, 350 is card — outside that is a typo. */
  @Type(() => Number) @IsInt() @Min(60) @Max(350) gsm!: number;

  @IsIn(FINISHES) finish!: string;
}

export class CreateReportCardOrderDto extends SpecDtoBase {
  @IsUUID() windowId!: string;
  @IsUUID() classSectionId!: string;

  /** Copies of the whole set — a class's cards usually print once. */
  @Type(() => Number) @IsInt() @Min(1) @Max(5000) quantity!: number;

  @IsOptional() @IsDateString() neededBy?: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

/**
 * Multipart alongside a PDF — every scalar arrives as a string, hence the
 * @Type coercions (the RecordPayment lesson: without them multipart bodies
 * fail validation on perfectly good numbers).
 */
export class CreateUploadOrderDto extends SpecDtoBase {
  @IsString() @Length(2, 120) title!: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(5000) quantity!: number;

  @IsOptional() @IsDateString() neededBy?: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class CancelOrderDto {
  @IsOptional() @IsString() @Length(0, 300) note?: string;
}

// ── Operator side ────────────────────────────────────────────────────────────

export class QuoteOrderDto {
  /** Whole order, paise. */
  @Type(() => Number) @IsInt() @Min(100) @Max(100_000_000) priceMinor!: number;

  /** The promise the school confirms against. Logged, and lateness is
   *  measured against it on the desk. */
  @IsDateString() promisedBy!: string;

  @IsOptional() @IsString() @Length(0, 300) note?: string;
}

export class DeclineOrderDto {
  /** Required to say something — the school reads this on the timeline. */
  @IsString() @Length(3, 300) reason!: string;
}

export class DispatchOrderDto {
  @IsString() @Length(2, 60) courier!: string;
  @IsOptional() @IsString() @Length(1, 60) ref?: string;
}
