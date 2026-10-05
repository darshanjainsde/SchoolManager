import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class StartRestoreDto {
  @IsUUID() backupId!: string;
  /** restore = the school is not on this server; replace = back up the current copy, remove it, restore. */
  @IsIn(['restore', 'replace']) mode!: 'restore' | 'replace';
  /** Import under another address. 2–32 lowercase letters, digits or dashes. */
  @IsOptional() @IsString() @Matches(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/) slug?: string;
  @IsIn(['LIVE', 'SUSPENDED', 'SETUP']) finalStatus!: 'LIVE' | 'SUSPENDED' | 'SETUP';
}

export class RegisterUploadDto {
  @IsString() @Matches(/^backups\/uploads\/[0-9a-f-]{36}\.sckools$/) key!: string;
}

/** One bucket, as the console names them. */
const BUCKETS = ['school', 'website', 'setup', 'day'] as const;
type BucketName = (typeof BUCKETS)[number];

/**
 * Putting buckets back into a school that is already here. Exactly one source:
 * a snapshot of this school, a sample pack, or `reset` (which puts nothing
 * back). The scope is widened server-side until emptying it strands nothing,
 * and the answer says what it was widened to.
 */
export class BucketRestoreDto {
  @ArrayNotEmpty() @IsArray() @IsIn(BUCKETS, { each: true }) buckets!: BucketName[];
  @IsOptional() @IsUUID() backupId?: string;
  @IsOptional() @IsUUID() packId?: string;
  /** Empty the buckets and put nothing back. */
  @IsOptional() @IsBoolean() reset?: boolean;
  /** Shift a pack's dates so it reads as the current session. Defaults to true. */
  @IsOptional() @IsBoolean() shiftDates?: boolean;
}

export class SnapshotDto {
  /** Which buckets to save now. Omitted means all four. */
  @IsOptional() @IsArray() @IsIn(BUCKETS, { each: true }) buckets?: BucketName[];
}

export class CreatePackDto {
  @IsUUID() schoolId!: string;
  @IsString() @Length(2, 60) name!: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

export class RegisterPackUploadDto {
  @IsString() @Matches(/^samples\/uploads\/[0-9a-f-]{36}\.sckools$/) key!: string;
  @IsString() @Length(2, 60) name!: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

export class RenamePackDto {
  @IsOptional() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}
