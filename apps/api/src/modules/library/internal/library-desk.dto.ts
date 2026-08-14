import { IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';
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

export class DeskDayQueryDto {
  /**
   * A calendar date in the ORG's timezone, not an instant. Omitted means the
   * org's own today, resolved in SQL — see `LibraryDeskService#today`.
   */
  @IsOptional()
  @IsISO8601()
  date?: string;
}
