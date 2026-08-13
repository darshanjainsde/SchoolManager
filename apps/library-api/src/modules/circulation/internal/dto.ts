import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class IssueBookDto {
  @IsString() @MinLength(1) @MaxLength(100) accessionNumber!: string;

  /**
   * Client-supplied foreign key. Never trusted at face value — the
   * controller/service must look this up on `tx`, inside the same
   * `withOrg` transaction as the write, before using it (see
   * `issues.service.ts`'s `issue` and LIBRARY-TRAPS.md's
   * client-supplied-fk-not-org-checked ledger entry: Postgres FK checks
   * bypass RLS by design, so the constraint alone is satisfied by a row
   * this caller cannot see).
   */
  @IsUUID('4') memberId!: string;
}

export class ReturnBookDto {
  @IsString() @MinLength(1) @MaxLength(100) accessionNumber!: string;
}

export class RenewBookDto {
  @IsString() @MinLength(1) @MaxLength(100) accessionNumber!: string;
}

export class CreateReservationDto {
  /** Client-supplied FK — looked up on `tx` in `reservations.service.ts`'s `createReservation`, same reasoning as `IssueBookDto.memberId` above. */
  @IsUUID('4') titleId!: string;

  /** Client-supplied FK — same reasoning. */
  @IsUUID('4') memberId!: string;
}

export const RESERVATION_STATUSES = ['PENDING', 'READY', 'COLLECTED', 'EXPIRED', 'CANCELLED'] as const;
export type ReservationStatusInput = (typeof RESERVATION_STATUSES)[number];

export class ListReservationsQueryDto {
  @IsOptional() @IsUUID('4') memberId?: string;
  @IsOptional() @IsUUID('4') titleId?: string;

  /** Filtered against the EFFECTIVE (read-time-computed) status — see `policy.ts`'s `reservationState` — not the raw stored column. */
  @IsOptional() @IsIn(RESERVATION_STATUSES) status?: ReservationStatusInput;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class WaiveFineDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export const FINE_STATUSES = ['OPEN', 'PAID', 'WAIVED', 'PARTIAL'] as const;
export type FineStatusInput = (typeof FINE_STATUSES)[number];

export class ListFinesQueryDto {
  @IsOptional() @IsUUID('4') memberId?: string;
  @IsOptional() @IsIn(FINE_STATUSES) status?: FineStatusInput;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class DayReportQueryDto {
  /** `YYYY-MM-DD`, interpreted as a UTC day. Omitted = today (UTC). */
  @IsOptional() @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' }) date?: string;
}

export class SearchMembersQueryDto {
  /**
   * Free text: a member code (`RAF-00042`, and the forgiving variants
   * `codeGuesses` accepts), a first or last name, or a full name. Omitted or
   * blank lists the roll alphabetically — the same fallback the catalogue
   * search makes for an empty query.
   *
   * Length-capped because it becomes an ILIKE pattern; a name nobody has is
   * still a scan nobody should be able to ask for repeatedly.
   */
  @IsOptional() @IsString() @MaxLength(100) q?: string;

  /**
   * The Sckools `Student.id` / `Teacher.id` this member was created from.
   *
   * This is the join Sckools uses to answer "what has this student borrowed?"
   * without ever reading the library's tables — it calls here with the id it
   * already has. Exact match only: it is an id, not a search term, so it does
   * not go through the ranking path at all.
   */
  @IsOptional() @IsUUID('4') externalRef?: string;

  /**
   * Max 50, not the 200 the other list DTOs allow: this feeds a typeahead
   * under a desk input, where a librarian picks from the first few or types
   * more. A bigger page would only ship more children's names to a browser.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
