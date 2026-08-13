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
  @IsOptional() @IsNumber() acquisitionCost?: number;
  @IsOptional() @IsIn(COPY_STATUSES) status?: CopyStatusInput;
}

export class UpdateCopyDto {
  @IsOptional() @IsString() @MaxLength(100) accessionNumber?: string;
  @IsOptional() @IsString() @MaxLength(100) shelf?: string;
  @IsOptional() @IsIn(COPY_CONDITIONS) condition?: CopyConditionInput;
  @IsOptional() @IsNumber() acquisitionCost?: number;
  @IsOptional() @IsIn(COPY_STATUSES) status?: CopyStatusInput;
}

export class CreateCategoryDto {
  @IsString() @MinLength(1) @MaxLength(150) name!: string;
  @IsOptional() @IsUUID('4') parentId?: string;
}
