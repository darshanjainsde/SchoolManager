import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class RegisterQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @IsUUID('4') branchId?: string;
}

export class StockTakeDto {
  /**
   * What the librarian typed while walking the shelves — ranges, single
   * numbers, or a mixture: `1001-1006, 1009, ACC-00042`.
   *
   * Generous length because a whole morning's verification arrives in one box,
   * and the range form means even a large library is a few hundred characters.
   */
  @IsString() @MinLength(1) @MaxLength(20_000) found!: string;

  @IsOptional() @IsUUID('4') branchId?: string;
}

export class WeedCopyDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
  /** The human who authorised removing a book nobody complained about. Same
   *  reasoning as a write-off's approver: there is no principal role to gate on. */
  @IsString() @MinLength(1) @MaxLength(300) approvedByNote!: string;
}
