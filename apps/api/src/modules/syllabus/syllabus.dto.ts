import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { SYLLABUS_STATUSES, type SyllabusStatus } from '@skoolos/types';

export class CreateChapterDto {
  @IsUUID() gradeId!: string;
  @IsUUID() subjectId!: string;
  /** Present = a sub-topic of that chapter. One level only. */
  @IsOptional() @IsUUID() parentId?: string;
  @IsString() @MinLength(1) @MaxLength(160) title!: string;
}

export class UpdateChapterDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) title?: string;
  @IsOptional() @IsInt() @Min(0) order?: number;
}

export class MarkProgressDto {
  @IsOptional() @IsIn([...SYLLABUS_STATUSES]) status?: SyllabusStatus;
  /** Empty string clears the note. */
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class StudentNoteDto {
  /** Empty string deletes the note. */
  @IsString() @MaxLength(2000) body!: string;
}
