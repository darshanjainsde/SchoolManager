import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

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
