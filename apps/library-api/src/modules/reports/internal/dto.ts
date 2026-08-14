import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A window is required rather than defaulted to "all time". Every one of these
 * reports answers a question about a TERM — "who has read nothing this term" is
 * meaningless without knowing which term — and an unbounded default would scan
 * a school's entire history to answer it.
 */
export class ReportWindowDto {
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' }) from!: string;
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' }) to!: string;
}

export class MostReadQueryDto extends ReportWindowDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ReadNothingQueryDto extends ReportWindowDto {
  @IsOptional() @IsString() @MaxLength(40) classRef?: string;
}

export class LateReturnersQueryDto extends ReportWindowDto {
  /** Everyone is late once; the default of 3 is what makes this a habit report. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(50) minLate?: number;
}
