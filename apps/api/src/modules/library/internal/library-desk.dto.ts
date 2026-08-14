import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
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

/**
 * A borrower reporting their own loss. Same single field as the counter's
 * shapes, and it lives beside them rather than in a file of its own because
 * `accessionNumber` means exactly the same thing on both sides of the desk —
 * splitting it would be two names for one number.
 */
export class ReportLostDto extends AccessionNumberDto {}

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

export class RecordDamageDto extends AccessionNumberDto {
  /**
   * `NEW` is excluded on purpose — "damaged, condition NEW" is a row nobody
   * can act on later. The service refuses it too; this is the earlier of the
   * two refusals, not the only one.
   */
  @IsIn(['GOOD', 'FAIR', 'POOR'])
  condition!: 'GOOD' | 'FAIR' | 'POOR';

  /** What is actually wrong, in her words. "Last twenty pages torn." */
  @IsString()
  @Length(1, 300)
  note!: string;
}

export class AddBookDto {
  @IsString()
  @Length(1, 300)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  author?: string;

  /**
   * Bounded at 50 because this is the counter's quick-add, not the import
   * path. A crate of 200 textbooks is a CSV job, and a form that pretends
   * otherwise produces a transaction nobody wants to be inside.
   */
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 32, { each: true })
  accessionNumbers!: string[];
}

export class NextNumbersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  count?: number;
}

export class NudgeClassTeachersDto {
  /**
   * Which classes to nudge, as the librarian's own labels ("6-B").
   *
   * Explicit rather than "everything late": she decides who gets a message,
   * and a button that quietly notified every class teacher in the school
   * would be used once and then never again.
   */
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  classRefs!: string[];
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

export class MarkPresentDto {
  /** The class's visit for today — `PeriodClass.visitId`, never re-derived here. */
  @IsUUID()
  visitId!: string;

  @IsUUID()
  memberId!: string;

  /**
   * `false` UNTICKS, and it is the reason this field exists rather than the
   * route being a bare "mark present". A false positive on attendance is far
   * worse than a false negative, and a mis-tap on a list of forty names is
   * only harmless while it can be taken back.
   *
   * Required, not optional. `markAttendance` treats an absent `present` as a
   * tick, which is a sensible default for a hand-written API call and a bad one
   * for a screen: a client that forgot the field would silently mark a child
   * present. The browser always knows which way it is toggling.
   */
  @IsBoolean()
  present!: boolean;
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
