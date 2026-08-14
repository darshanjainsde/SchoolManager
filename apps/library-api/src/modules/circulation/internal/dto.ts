import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

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

export const WAIVER_REASONS = [
  'BOOK_FOUND',
  'REPLACED_IN_KIND',
  'WRITTEN_OFF_UNREPLACEABLE',
  'HARDSHIP',
  'LIBRARY_ERROR',
  'GOODWILL',
] as const;
export type WaiverReasonInput = (typeof WAIVER_REASONS)[number];

export class WaiveFineDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;

  /**
   * REQUIRED. Free text alone is unaggregatable — the collections dashboard
   * asks "where did each rupee go" and four hundred unique strings cannot
   * answer it. It is also how the two MECHANICAL outcomes (the book was found,
   * the family replaced it) end up inflating a school's "let off" figure when
   * it lost nothing either time.
   *
   * `LIBRARY_ERROR` matters more than it looks: it is the honest home for "I
   * typed the wrong number and charged the wrong child", which has no route at
   * all today.
   */
  @IsIn(WAIVER_REASONS) reasonCode!: WaiverReasonInput;
}

export class ListDuesQueryDto {
  /** Split students from teachers: a teacher's ₹300 must never sit inside a
   *  figure a principal reads as what the children owe. */
  @IsOptional() @IsIn(['STUDENT', 'TEACHER', 'EXTERNAL']) memberType?: 'STUDENT' | 'TEACHER' | 'EXTERNAL';

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
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

export class ReportLostDto {
  @IsString() @MinLength(1) @MaxLength(100) accessionNumber!: string;

  /**
   * The per-loss override — what the librarian says a replacement costs for
   * THIS book, typed while looking at it. Optional: when omitted the price is
   * resolved from the title, then from what the school paid, then not at all
   * (see `common/replacement-price.ts`).
   *
   * Same bounds as `CreateTitleDto.replacementPrice`, and for the same reasons:
   * two decimal places to match DECIMAL(10,2), a lower bound of 0 because
   * negative money would credit a parent for losing a book, and a ₹100000
   * ceiling to catch `29900` typed for `299.00` before it becomes a bill.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  replacementPrice?: number;
}

export class SelfReportLostDto {
  @IsString() @MinLength(1) @MaxLength(100) accessionNumber!: string;
}

export class ConfirmLostDto {
  /** The per-loss override, typed by the librarian at confirmation — the one
   *  moment a human is looking at the actual book. Same bounds as
   *  `ReportLostDto.replacementPrice`. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  replacementPrice?: number;
}

export class RejectLostDto {
  /** Required. A rejection that does not say why is indistinguishable, later,
   *  from a mistake — and this row stays in the history for good. */
  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class PayLostDto {
  /** How the money actually crossed the counter. */
  @IsIn(['CASH', 'UPI', 'OTHER']) method!: 'CASH' | 'UPI' | 'OTHER';

  /** Required by convention when `method` is OTHER; also where a paper receipt
   *  or slip number goes. */
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class WriteOffLostDto {
  /**
   * The human who authorised it, in words — "Principal Mrs Rao, note dated 12
   * Aug". Free text on purpose: there is no principal ROLE in this service, and
   * inventing one to gate write-off would, in a school where the librarian is
   * the only account, produce either a due that can never be closed or a fake
   * "paid" entry. Recorded approval that is auditable beats a gate that gets
   * routed around — so this is REQUIRED.
   */
  @IsString() @MinLength(1) @MaxLength(300) approvedByNote!: string;

  @IsString() @MinLength(1) @MaxLength(500) reason!: string;
}

export class ReplaceInKindDto {
  /**
   * The number the librarian writes inside the new copy's front cover. Typed,
   * not generated: they have to write it by hand anyway, and the accession
   * allocator is P5's problem.
   */
  @IsString() @MinLength(1) @MaxLength(100) accessionNumber!: string;

  /** Defaults to GOOD, not NEW — a parent's replacement is usually second-hand. */
  @IsOptional() @IsIn(['NEW', 'GOOD', 'FAIR', 'POOR']) condition?: 'NEW' | 'GOOD' | 'FAIR' | 'POOR';
}

export class ReportMissingDto {
  @IsString() @MinLength(1) @MaxLength(100) accessionNumber!: string;
}

export class CollectionsQueryDto {
  /** Calendar dates in the ORG's timezone, resolved by `dayRangeForOrg` —
   *  never UTC. Omit both for today. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

export class WaiverLogQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class TurnedUpDto {
  /**
   * REFUND_OWED puts the book back on the shelf and writes down what the school
   * owes the family. FAMILY_KEEPS leaves the copy retired — they paid for it,
   * so it is theirs. Neither moves money; this software records, it does not pay.
   */
  @IsIn(['REFUND_OWED', 'FAMILY_KEEPS']) outcome!: 'REFUND_OWED' | 'FAMILY_KEEPS';
}
