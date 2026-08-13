import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SuggestQueryDto {
  /**
   * Anything the person at the counter types: a book number, a name, a member
   * code, a title, an author. Length-capped because it becomes a search
   * pattern; a query nobody could mean is still work nobody should be able to
   * ask for repeatedly.
   */
  @IsString() @MaxLength(120) q!: string;

  /** Small on purpose — this is a dropdown under an input, not a results page. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit?: number;
}
