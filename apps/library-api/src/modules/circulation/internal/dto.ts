import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

export class IssueLoanDto {
  @IsString() @MinLength(1) @MaxLength(100) barcode!: string;

  /**
   * Client-supplied foreign key. Never trusted at face value — the
   * controller/service must look this up on `tx`, inside the same
   * `withOrg` transaction as the write, before using it (see
   * `loans.service.ts`'s `issue` and LIBRARY-TRAPS.md's
   * client-supplied-fk-not-org-checked ledger entry: Postgres FK checks
   * bypass RLS by design, so the constraint alone is satisfied by a row
   * this caller cannot see).
   */
  @IsUUID('4') memberId!: string;
}

export class ReturnLoanDto {
  @IsString() @MinLength(1) @MaxLength(100) barcode!: string;
}

export class RenewLoanDto {
  @IsString() @MinLength(1) @MaxLength(100) barcode!: string;
}

export class CreateHoldDto {
  /** Client-supplied FK — looked up on `tx` in `holds.service.ts`'s `createHold`, same reasoning as `IssueLoanDto.memberId` above. */
  @IsUUID('4') titleId!: string;

  /** Client-supplied FK — same reasoning. */
  @IsUUID('4') memberId!: string;
}

export const HOLD_STATUSES = ['PENDING', 'READY', 'COLLECTED', 'EXPIRED', 'CANCELLED'] as const;
export type HoldStatusInput = (typeof HOLD_STATUSES)[number];

export class ListHoldsQueryDto {
  @IsOptional() @IsUUID('4') memberId?: string;
  @IsOptional() @IsUUID('4') titleId?: string;

  /** Filtered against the EFFECTIVE (read-time-computed) status — see `policy.ts`'s `holdState` — not the raw stored column. */
  @IsOptional() @IsIn(HOLD_STATUSES) status?: HoldStatusInput;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class WaiveFineDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;

  /** Omitted = waive the full outstanding balance (`amount - paidAmount`). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount?: number;
}
