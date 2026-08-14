import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Counter request shapes.
 *
 * Declared here rather than reused from `management.dto.ts`: the module
 * boundary forbids `library/**` importing `management/**` internals, and a
 * shared DTO between two modules backed by two different databases is exactly
 * the coupling `library.module.ts` exists to avoid.
 *
 * Bounds are asserted by e2e, never by a curl against `pnpm dev` — `tsx` does
 * not emit the metadata Nest's ValidationPipe needs, so a dev server skips DTO
 * validation entirely and proves nothing about any bound below (trap 18).
 */

export class SearchMembersQueryDto {
  /** Two characters is the service's own floor; below it the answer is always []. */
  @IsString()
  @Length(1, 60)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/**
 * The number written inside the front cover. Never called a barcode, and
 * never scanned — the product's promise is that a school needs no hardware,
 * so this is a string a librarian types.
 */
export class AccessionNumberDto {
  @IsString()
  @Length(1, 32)
  accessionNumber!: string;
}

export class IssueAtDeskDto extends AccessionNumberDto {
  /**
   * `@IsUUID` is the shape check, not the authorization one. A member
   * belonging to another school is refused because the lookup runs inside
   * `withOrg` — a foreign key would not have caught it, since Postgres checks
   * referential integrity with RLS bypassed.
   */
  @IsUUID()
  memberId!: string;
}

export class UndoIssueDto {
  @IsUUID()
  issueId!: string;

  /**
   * Required, never optional. This deletes the issue row, so the audit entry
   * is the only record it ever existed — "Wrong number typed" is a sentence
   * that makes the history readable a year later, and an empty reason makes it
   * a mystery.
   */
  @IsString()
  @Length(1, 200)
  reason!: string;
}

export class DeskDayQueryDto {
  /**
   * A calendar date in the ORG's timezone, not an instant. Omitted means the
   * org's own today, resolved in SQL — see `LibraryDeskService#today`.
   */
  @IsOptional()
  @IsISO8601()
  date?: string;
}
