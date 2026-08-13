import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const AUTHOR_ROLES = ['AUTHOR', 'EDITOR', 'TRANSLATOR'] as const;
export type AuthorRoleInput = (typeof AUTHOR_ROLES)[number];

export const COPY_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR'] as const;
export type CopyConditionInput = (typeof COPY_CONDITIONS)[number];

/**
 * Fat-finger ceiling for a replacement price, in rupees. Deliberately generous
 * — a multi-volume reference set is a real thing a school library owns — but
 * low enough to catch the paise-vs-rupees slip (`29900` for `299.00`) before it
 * becomes a bill. Exported so the CSV importer validates the identical bound
 * rather than re-deriving one that drifts.
 */
export const REPLACEMENT_PRICE_MAX = 100_000;

export const COPY_STATUSES = [
  'AVAILABLE',
  'ISSUED',
  'RESERVED_SHELF',
  'IN_TRANSIT',
  'LOST',
  'DAMAGED',
  'WITHDRAWN',
] as const;
export type CopyStatusInput = (typeof COPY_STATUSES)[number];

export class TitleAuthorInputDto {
  @IsString() @MinLength(1) @MaxLength(200) name!: string;

  /** Defaults to `name` in the service if omitted — callers that want correct
   * "Last, First" sort order should pass this explicitly. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) sortName?: string;

  @IsOptional() @IsIn(AUTHOR_ROLES) role?: AuthorRoleInput;
}

export class CreateTitleDto {
  @IsString() @MinLength(1) @MaxLength(500) title!: string;
  @IsOptional() @IsString() @MaxLength(500) subtitle?: string;
  @IsOptional() @IsString() @MaxLength(20) isbn13?: string;
  @IsOptional() @IsString() @MaxLength(20) isbn10?: string;
  @IsOptional() @IsString() @MaxLength(300) publisher?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3000) publishedYear?: number;
  @IsOptional() @IsString() @MaxLength(100) edition?: string;
  @IsOptional() @IsString() @MaxLength(20) language?: string;
  @IsOptional() @IsString() @MaxLength(100) callNumber?: string;
  @IsOptional() @IsString() @MaxLength(2000) coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @IsOptional() @IsInt() @Min(0) pageCount?: number;

  /**
   * What it costs to buy this book again today — the number a parent is asked
   * to pay for a lost copy. NOT `AddCopyDto.acquisitionCost`, which is what the
   * school paid, per copy, from the bill.
   *
   * `maxDecimalPlaces: 2` matches the DECIMAL(10,2) column so `299.999` is
   * rejected at the edge rather than silently rounded by Postgres. The upper
   * bound is a fat-finger guard: `29900` typed for `299.00` would otherwise
   * become a bill to a parent for twenty-nine thousand rupees. It lives here
   * and not in a CHECK constraint precisely because it is a business judgement
   * a school with an expensive reference set could need relaxed, and relaxing a
   * decorator does not cost a migration. The lower bound IS also a CHECK
   * (`Title_replacementPrice_nonnegative`): negative money would credit a
   * parent for losing a book, and no path should be able to produce it.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(REPLACEMENT_PRICE_MAX)
  replacementPrice?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TitleAuthorInputDto)
  authors?: TitleAuthorInputDto[];

  @IsOptional() @IsArray() @IsUUID('4', { each: true }) categoryIds?: string[];
}

/** Scalar fields only — relinking authors/categories is out of scope for this PATCH. */
export class UpdateTitleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(500) title?: string;
  @IsOptional() @IsString() @MaxLength(500) subtitle?: string;
  @IsOptional() @IsString() @MaxLength(20) isbn13?: string;
  @IsOptional() @IsString() @MaxLength(20) isbn10?: string;
  @IsOptional() @IsString() @MaxLength(300) publisher?: string;
  @IsOptional() @IsInt() @Min(0) @Max(3000) publishedYear?: number;
  @IsOptional() @IsString() @MaxLength(100) edition?: string;
  @IsOptional() @IsString() @MaxLength(20) language?: string;
  @IsOptional() @IsString() @MaxLength(100) callNumber?: string;
  @IsOptional() @IsString() @MaxLength(2000) coverUrl?: string;
  @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @IsOptional() @IsInt() @Min(0) pageCount?: number;

  /**
   * See `CreateTitleDto.replacementPrice`.
   *
   * `null` is meaningful here and is how a librarian CLEARS a wrongly-entered
   * price: `@IsOptional()` skips validation for both `undefined` and `null`
   * (class-validator 0.14.4 — verified against the installed package, not
   * recalled), and `TitlesService.update` passes the value straight into
   * Prisma's `data`, where `undefined` means "leave alone" and `null` means
   * "set to NULL". "No price on record" is a designed state — a lost book with
   * no price still records fine, the librarian just types an amount at the
   * counter — so the UI has to be able to reach it. Covered by an e2e that
   * PATCHes null and asserts the column really goes back to NULL, because that
   * behaviour depends on three separate libraries lining up and would break
   * silently if any of them changed.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(REPLACEMENT_PRICE_MAX)
  replacementPrice?: number | null;
}

export class SearchTitlesQueryDto {
  @IsOptional() @IsString() @MaxLength(200) q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AddCopyDto {
  @IsUUID('4') branchId!: string;
  /**
   * The number written inside the front cover. Required, because a copy with no
   * number cannot be lent, shelved or audited — and this service has no other
   * identifier for a physical book.
   *
   * Digits in practice (they run in sequence per library, which is what lets
   * stock verification accept a whole shelf as a range), but stored as text so
   * a school with a legacy prefix is not locked out.
   */
  @IsString() @MinLength(1) @MaxLength(100) accessionNumber!: string;
  @IsOptional() @IsString() @MaxLength(100) shelf?: string;
  @IsOptional() @IsIn(COPY_CONDITIONS) condition?: CopyConditionInput;
  @IsOptional() @IsDateString() acquiredAt?: string;

  /**
   * What the school PAID for this copy, from the bill — historic, per copy, and
   * not what a replacement costs today. It became a money-bearing input rather
   * than a bookkeeping note when `copies.service.ts` started seeding
   * `Title.replacementPrice` from it, so it now carries the same bounds as
   * `CreateTitleDto.replacementPrice`, from the same constant.
   *
   * Unbounded, this was the widest write path to a parent's bill in the
   * service: every direct path caps at ₹100000, while an `acquisitionCost` of
   * 5000000 on an unpriced title seeded `replacementPrice = 5000000.00` — a
   * value no endpoint would accept and no console field could produce.
   *
   * `@Min(0)` also turns a negative into a clean 400. Without it the insert
   * succeeded (`Copy` has no CHECK), the seed's UPDATE then violated
   * `Title_replacementPrice_nonnegative`, and Prisma raises that as a
   * `PrismaClientUnknownRequestError` with no `.code` — which `mapPrismaError`
   * rethrows, so the caller got a 500 AND lost the copy to the rollback, on a
   * request that used to return 201.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(REPLACEMENT_PRICE_MAX)
  acquisitionCost?: number;

  @IsOptional() @IsIn(COPY_STATUSES) status?: CopyStatusInput;
}

export class UpdateCopyDto {
  @IsOptional() @IsString() @MaxLength(100) accessionNumber?: string;
  @IsOptional() @IsString() @MaxLength(100) shelf?: string;
  @IsOptional() @IsIn(COPY_CONDITIONS) condition?: CopyConditionInput;

  /** Same bounds and same reasoning as `AddCopyDto.acquisitionCost`. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(REPLACEMENT_PRICE_MAX)
  acquisitionCost?: number;

  @IsOptional() @IsIn(COPY_STATUSES) status?: CopyStatusInput;
}

export class CreateCategoryDto {
  @IsString() @MinLength(1) @MaxLength(150) name!: string;
  @IsOptional() @IsUUID('4') parentId?: string;
}
