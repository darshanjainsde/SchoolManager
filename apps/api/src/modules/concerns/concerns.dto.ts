import { IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CONCERN_AUDIENCES, CONCERN_CATEGORIES, CONCERN_STATUSES } from '@skoolos/types';

/** What a family writes. The route (`audience`) is their choice, not the screen's. */
export class RaiseConcernDto {
  @IsOptional() @IsUUID() studentId?: string;
  @IsIn([...CONCERN_AUDIENCES]) audience!: (typeof CONCERN_AUDIENCES)[number];
  @IsIn([...CONCERN_CATEGORIES]) category!: (typeof CONCERN_CATEGORIES)[number];
  @IsString() @MinLength(3) @MaxLength(160) title!: string;
  @IsString() @MinLength(3) @MaxLength(4000) body!: string;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) attachmentIds?: string[];
}

export class ConcernCommentDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  /** Only the school may send this false — a note the family never sees. */
  @IsOptional() visibleToFamily?: boolean;
}

export class ConcernStatusDto {
  @IsIn([...CONCERN_STATUSES]) status!: (typeof CONCERN_STATUSES)[number];
  @IsOptional() @IsString() @MaxLength(4000) note?: string;
}

export class ReopenConcernDto {
  @IsString() @MinLength(3) @MaxLength(4000) body!: string;
}
